import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { withLiveEstimate } from './estimates.js';
import { HttpError, invalidInput, requireResourceId, requireRole } from './http.js';
import { appendEvent, closeCounter, lockService, readToken, tokenSelect, withTransaction } from './queue.js';

const transitions = [
    { action: 'start', from: 'CALLED', to: 'IN_SERVICE' },
    { action: 'complete', from: 'IN_SERVICE', to: 'COMPLETED' },
    { action: 'skip', from: 'CALLED', to: 'SKIPPED' },
    { action: 'no-show', from: 'CALLED', to: 'NO_SHOW' },
];

function tokenId(value) {
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)) {
        throw invalidInput('Token ID must be a UUID.');
    }
    return value.toLowerCase();
}

function tokenNotFound() {
    return new HttpError(404, 'NOT_FOUND', 'Token was not found.');
}

function requireStatus(token, status) {
    if (token.status !== status) {
        throw new HttpError(409, 'INVALID_TRANSITION', 'This action is unavailable for the current token status.');
    }
}

async function issueToken(db, studentId, serviceId) {
    const service = await lockService(db, serviceId);
    const [[existing]] = await db.execute(
        `${tokenSelect}
         WHERE t.student_id = ? AND t.service_id = ?
             AND t.status IN ('WAITING', 'CALLED', 'IN_SERVICE')`,
        [studentId, serviceId],
    );
    if (existing) {
        return { status: 200, token: await withLiveEstimate(db, existing) };
    }
    if (!Number(service.accepts_tokens)) {
        throw new HttpError(409, 'SERVICE_DISABLED', 'This service is no longer accepting new tokens.');
    }

    // Capture one database instant after locking so numbering and issuance agree at midnight.
    const [[{ issuedAt, queueDate }]] = await db.execute(
        `SELECT date_format(UTC_TIMESTAMP(6), '%Y-%m-%d %H:%i:%s.%f') AS issuedAt,
                date(UTC_TIMESTAMP(6) + interval 330 minute) AS queueDate`,
    );
    await db.execute(
        `INSERT INTO queue_sessions (service_id, queue_date, last_sequence) VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE last_sequence = last_sequence + 1`,
        [serviceId, queueDate],
    );
    const [[session]] = await db.execute(
        'SELECT id, last_sequence FROM queue_sessions WHERE service_id = ? AND queue_date = ?',
        [serviceId, queueDate],
    );
    const id = randomUUID();
    await db.execute(
        `INSERT INTO tokens (id, student_id, service_id, queue_session_id, sequence, issued_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, studentId, serviceId, session.id, session.last_sequence, issuedAt],
    );
    await appendEvent(db, {
        tokenId: id, actorId: studentId, fromStatus: null, toStatus: 'WAITING',
    });
    const token = await withLiveEstimate(db, await readToken(db, id));
    const { estimatedWaitSeconds, estimatedWaitBasis } = token;
    if (estimatedWaitSeconds !== null) {
        await db.execute(
            `UPDATE tokens SET estimate_seconds = ?, estimate_basis = ? WHERE id = ?`,
            [estimatedWaitSeconds, estimatedWaitBasis, token.id],
        );
    }
    return {
        status: 201,
        token: { ...token, estimateSeconds: estimatedWaitSeconds, estimateBasis: estimatedWaitBasis },
    };
}

async function cancelToken(db, id, studentId) {
    const [[location]] = await db.execute(
        'SELECT service_id FROM tokens WHERE id = ? AND student_id = ?',
        [id, studentId],
    );
    if (!location) {
        throw tokenNotFound();
    }
    await lockService(db, location.service_id);
    const [[token]] = await db.execute(
        'SELECT status FROM tokens WHERE id = ? AND student_id = ? FOR UPDATE',
        [id, studentId],
    );
    if (!token) {
        throw tokenNotFound();
    }
    requireStatus(token, 'WAITING');

    await db.execute(
        `UPDATE tokens SET status = 'CANCELLED', closed_at = greatest(UTC_TIMESTAMP(6), issued_at)
         WHERE id = ?`,
        [id],
    );
    await appendEvent(db, {
        tokenId: id, actorId: studentId, fromStatus: 'WAITING', toStatus: 'CANCELLED',
    });
    return withLiveEstimate(db, await readToken(db, id));
}

async function transitionToken(db, id, staffId, { from, to }, reason) {
    const [[location]] = await db.execute(
        'SELECT service_id FROM tokens WHERE id = ?',
        [id],
    );
    if (!location) {
        throw tokenNotFound();
    }

    // All mutations lock the service before its counter and token.
    await lockService(db, location.service_id);
    const [[counter]] = await db.execute(
        `SELECT c.id, c.status FROM counters AS c
         JOIN staff_assignments AS a ON a.counter_id = c.id
         WHERE a.staff_id = ? AND c.service_id = ? FOR UPDATE OF c`,
        [staffId, location.service_id],
    );
    const [[token]] = await db.execute(
        'SELECT status, counter_id FROM tokens WHERE id = ? FOR UPDATE',
        [id],
    );
    if (!token) {
        throw tokenNotFound();
    }
    if (!counter || (token.counter_id !== null && token.counter_id !== counter.id)) {
        throw new HttpError(403, 'FORBIDDEN', 'You are not assigned to this counter.');
    }
    requireStatus(token, from);

    await db.execute(
        `UPDATE tokens SET status = ?,
             started_at = CASE WHEN ? = 'IN_SERVICE'
                 THEN greatest(UTC_TIMESTAMP(6), called_at) ELSE started_at END,
             completed_at = CASE WHEN ? = 'COMPLETED'
                 THEN greatest(UTC_TIMESTAMP(6), started_at) END,
             closed_at = CASE WHEN ? <> 'IN_SERVICE'
                 THEN greatest(UTC_TIMESTAMP(6), coalesce(started_at, called_at)) END
         WHERE id = ?`,
        [to, to, to, to, id],
    );
    await appendEvent(db, {
        tokenId: id, actorId: staffId, fromStatus: from, toStatus: to, reason,
    });
    if (to !== 'IN_SERVICE' && counter.status === 'DRAINING') {
        await closeCounter(db, counter.id);
    }
    return readToken(db, id);
}

export function tokenRouter(pool) {
    const router = Router();
    const student = requireRole('STUDENT');
    const staff = requireRole('STAFF');

    router.post('/', student, async (req, res) => {
        const serviceId = requireResourceId(req.body?.serviceId);
        const result = await withTransaction(pool, (db) => issueToken(db, req.user.id, serviceId));
        res.status(result.status).json({ data: result.token });
    });

    router.get('/', student, async (req, res) => {
        const data = await withTransaction(pool, async (db) => {
            const [rows] = await db.execute(
                `${tokenSelect} WHERE t.student_id = ? ORDER BY t.issued_at DESC, t.id`,
                [req.user.id],
            );
            const tokens = [];
            for (const token of rows) {
                tokens.push(await withLiveEstimate(db, token));
            }
            return tokens;
        }, { readOnly: true });
        res.json({ data });
    });

    router.get('/:id', student, async (req, res) => {
        const id = tokenId(req.params.id);
        const data = await withTransaction(pool, async (db) => {
            const [[token]] = await db.execute(
                `${tokenSelect} WHERE t.id = ? AND t.student_id = ?`,
                [id, req.user.id],
            );
            if (!token) {
                throw tokenNotFound();
            }
            return withLiveEstimate(db, token);
        }, { readOnly: true });
        res.json({ data });
    });

    router.post('/:id/cancel', student, async (req, res) => {
        const id = tokenId(req.params.id);
        const token = await withTransaction(pool, (db) => cancelToken(db, id, req.user.id));
        res.json({ data: token });
    });

    for (const transition of transitions) {
        router.post(`/:id/${transition.action}`, staff, async (req, res) => {
            const id = tokenId(req.params.id);
            const reason = transition.action === 'skip' ? req.body?.reason : null;
            if (transition.action === 'skip'
                && (typeof reason !== 'string' || !reason.trim() || reason.length > 500 || reason.includes('\0'))) {
                throw invalidInput('Enter a skip reason of 1 to 500 characters.');
            }
            const token = await withTransaction(
                pool, (db) => transitionToken(db, id, req.user.id, transition, reason?.trim()),
            );
            res.json({ data: token });
        });
    }

    return router;
}
