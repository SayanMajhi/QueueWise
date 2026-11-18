import { HttpError } from './http.js';

export const tokenSelect = `
    SELECT t.id, t.service_id AS "serviceId", s.code AS "serviceCode",
           s.name AS "serviceName", q.queue_date AS "queueDate", t.sequence,
           concat(s.code, '-', date_format(q.queue_date, '%Y%m%d'), '-',
               lpad(t.sequence, greatest(3, char_length(t.sequence)), '0')) AS "tokenNumber",
           t.status, t.counter_id AS "counterId", c.name AS "counterName",
           c.code AS "counterCode", t.issued_at AS "issuedAt",
           t.called_at AS "calledAt", t.started_at AS "startedAt",
           t.completed_at AS "completedAt", t.closed_at AS "closedAt",
           t.estimate_seconds AS "estimateSeconds", t.estimate_basis AS "estimateBasis",
           CASE WHEN t.status = 'WAITING' THEN CAST(1 + (
               SELECT count(*)
               FROM tokens AS earlier
               JOIN queue_sessions AS earlier_day ON earlier_day.id = earlier.queue_session_id
               WHERE earlier.service_id = t.service_id AND earlier.status = 'WAITING'
                   AND (earlier_day.queue_date, earlier.sequence) < (q.queue_date, t.sequence)
           ) AS DOUBLE) END AS position
    FROM tokens AS t
    JOIN queue_sessions AS q ON q.id = t.queue_session_id
    JOIN services AS s ON s.id = t.service_id
    LEFT JOIN counters AS c ON c.id = t.counter_id`;

export async function withTransaction(pool, work, { readOnly = false } = {}) {
    const client = await pool.getConnection();
    let reusable = true;
    try {
        await client.query(readOnly
            ? 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'
            : 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ WRITE');
        await client.beginTransaction();
        const result = await work(client);
        await client.commit();
        return result;
    } catch (error) {
        try {
            await client.rollback();
        } catch {
            reusable = false;
        }
        throw error;
    } finally {
        if (reusable) {
            client.release();
        } else {
            client.destroy();
        }
    }
}

export async function lockService(client, serviceId) {
    const [[service]] = await client.execute(
        `SELECT id, accepts_tokens, default_service_seconds
         FROM services WHERE id = ? FOR UPDATE`,
        [serviceId],
    );
    if (!service) {
        throw new HttpError(404, 'NOT_FOUND', 'Service was not found.');
    }
    return service;
}

export async function readToken(db, id) {
    const [[token]] = await db.execute(`${tokenSelect} WHERE t.id = ?`, [id]);
    return token;
}

export function appendEvent(db, { tokenId, actorId, fromStatus, toStatus, reason = null }) {
    return db.execute(
        `INSERT INTO token_events (token_id, actor_id, event_at, from_status, to_status, reason)
         SELECT id, ?, CASE status
             WHEN 'WAITING' THEN issued_at
             WHEN 'CALLED' THEN called_at
             WHEN 'IN_SERVICE' THEN started_at
             ELSE closed_at
         END, ?, ?, ?
         FROM tokens WHERE id = ?`,
        [actorId, fromStatus, toStatus, reason, tokenId],
    );
}

export async function closeCounter(db, counterId) {
    const [result] = await db.execute(
        `UPDATE counter_availability
         SET closed_at = greatest(UTC_TIMESTAMP(6), opened_at + interval 1 microsecond)
         WHERE counter_id = ? AND closed_at IS NULL`,
        [counterId],
    );
    if (result.affectedRows !== 1) {
        throw new Error('A staffed counter must have one open availability interval.');
    }
    await db.execute("UPDATE counters SET status = 'CLOSED' WHERE id = ?", [counterId]);
}
