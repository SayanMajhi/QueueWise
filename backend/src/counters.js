import { Router } from 'express';
import { HttpError, requireResourceId, requireRole } from './http.js';
import { appendEvent, closeCounter, lockService, readToken, tokenSelect, withTransaction } from './queue.js';

function counterDto(counter) {
    const { id, serviceId, code, name, status } = counter;
    return { id, serviceId, code, name, status };
}

async function readAssignedCounter(db, counterId, staffId, lock = false) {
    const [[counter]] = await db.execute(
        `SELECT c.id, c.service_id AS "serviceId", c.code, c.name, c.status,
                EXISTS (
                    SELECT 1 FROM staff_assignments AS a
                    WHERE a.counter_id = c.id AND a.staff_id = ?
                ) AS assigned
         FROM counters AS c
         WHERE c.id = ?
         ${lock ? 'FOR UPDATE OF c' : ''}`,
        [staffId, counterId],
    );

    if (!counter) {
        throw new HttpError(404, 'NOT_FOUND', 'Counter was not found.');
    }
    if (!Number(counter.assigned)) {
        throw new HttpError(403, 'FORBIDDEN', 'You are not assigned to this counter.');
    }
    return counter;
}

async function withAssignedCounter(pool, req, work) {
    const counterId = requireResourceId(req.params.id, 'Counter ID');
    return withTransaction(pool, async (client) => {
        const counter = await readAssignedCounter(client, counterId, req.user.id);
        await lockService(client, counter.serviceId);
        const lockedCounter = await readAssignedCounter(client, counterId, req.user.id, true);
        return work(client, lockedCounter);
    });
}

async function readCurrentTokenId(db, counterId) {
    const [[token]] = await db.execute(
        `SELECT id FROM tokens
         WHERE counter_id = ? AND status IN ('CALLED', 'IN_SERVICE')`,
        [counterId],
    );
    return token?.id ?? null;
}

export function counterRouter(pool) {
    const router = Router();
    const staffOnly = requireRole('STAFF');

    router.get('/staff/counters', staffOnly, async (req, res) => {
        const [rows] = await pool.execute(
            `SELECT c.id, c.service_id AS "serviceId", c.code, c.name, c.status
             FROM counters AS c
             JOIN staff_assignments AS a ON a.counter_id = c.id
             WHERE a.staff_id = ?
             ORDER BY c.name, c.id`,
            [req.user.id],
        );
        res.json({ data: rows });
    });

    router.get('/counters/:id/queue', staffOnly, async (req, res) => {
        const counterId = requireResourceId(req.params.id, 'Counter ID');
        const data = await withTransaction(pool, async (client) => {
            const counter = await readAssignedCounter(client, counterId, req.user.id);
            const [rows] = await client.execute(
                `${tokenSelect}
                 WHERE t.service_id = ? AND (
                     t.status = 'WAITING'
                     OR (t.counter_id = ? AND t.status IN ('CALLED', 'IN_SERVICE'))
                 )
                 ORDER BY q.queue_date, t.sequence`,
                [counter.serviceId, counter.id],
            );

            const currentToken = rows.find((token) => token.status !== 'WAITING') ?? null;
            const waiting = rows.filter((token) => token.status === 'WAITING');
            return { counter: counterDto(counter), currentToken, waiting };
        }, { readOnly: true });
        res.json({ data });
    });

    router.post('/counters/:id/open', staffOnly, async (req, res) => {
        const data = await withAssignedCounter(pool, req, async (client, counter) => {
            if (counter.status === 'DRAINING') {
                throw new HttpError(409, 'COUNTER_DRAINING', 'Resolve the current token before reopening the counter.');
            }
            if (counter.status === 'CLOSED') {
                await client.execute(
                    `INSERT INTO counter_availability (counter_id, opened_at)
                     VALUES (?, UTC_TIMESTAMP(6))`,
                    [counter.id],
                );
                await client.execute(
                    "UPDATE counters SET status = 'OPEN' WHERE id = ?",
                    [counter.id],
                );
            }
            return counterDto({ ...counter, status: 'OPEN' });
        });
        res.json({ data });
    });

    router.post('/counters/:id/close', staffOnly, async (req, res) => {
        const data = await withAssignedCounter(pool, req, async (client, counter) => {
            if (counter.status !== 'OPEN') {
                return counterDto(counter);
            }
            if (await readCurrentTokenId(client, counter.id) !== null) {
                await client.execute(
                    "UPDATE counters SET status = 'DRAINING' WHERE id = ?",
                    [counter.id],
                );
                return counterDto({ ...counter, status: 'DRAINING' });
            }
            await closeCounter(client, counter.id);
            return counterDto({ ...counter, status: 'CLOSED' });
        });
        res.json({ data });
    });

    router.post('/counters/:id/call-next', staffOnly, async (req, res) => {
        const data = await withAssignedCounter(pool, req, async (client, counter) => {
            if (counter.status !== 'OPEN') {
                throw new HttpError(409, 'COUNTER_UNAVAILABLE', 'Open the counter before calling a token.');
            }
            if (await readCurrentTokenId(client, counter.id) !== null) {
                throw new HttpError(409, 'COUNTER_BUSY', 'Resolve the current token before calling another.');
            }

            const [[next]] = await client.execute(
                `SELECT t.id
                 FROM tokens AS t
                 JOIN queue_sessions AS q ON q.id = t.queue_session_id
                 WHERE t.service_id = ? AND t.status = 'WAITING'
                 ORDER BY q.queue_date, t.sequence
                 LIMIT 1 FOR UPDATE OF t`,
                [counter.serviceId],
            );
            if (!next) {
                return null;
            }

            await client.execute(
                `UPDATE tokens
                 SET status = 'CALLED', counter_id = ?, called_at = greatest(UTC_TIMESTAMP(6), issued_at)
                 WHERE id = ?`,
                [counter.id, next.id],
            );
            await appendEvent(client, {
                tokenId: next.id,
                actorId: req.user.id,
                fromStatus: 'WAITING',
                toStatus: 'CALLED',
            });
            return readToken(client, next.id);
        });
        res.json({ data });
    });

    return router;
}
