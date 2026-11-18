import { Router } from 'express';
import { HttpError, requireResourceId } from './http.js';

const queueFields = `counts.waiting, counts.called, counts.inService,
    (SELECT CAST(count(*) AS DOUBLE) FROM counters
     WHERE service_id = s.id AND status = 'OPEN') AS "openCounters"`;
const queueJoin = `JOIN LATERAL (
    SELECT CAST(count(CASE WHEN status = 'WAITING' THEN 1 END) AS DOUBLE) AS waiting,
           CAST(count(CASE WHEN status = 'CALLED' THEN 1 END) AS DOUBLE) AS called,
           CAST(count(CASE WHEN status = 'IN_SERVICE' THEN 1 END) AS DOUBLE) AS inService
    FROM tokens WHERE service_id = s.id AND status IN ('WAITING', 'CALLED', 'IN_SERVICE')
) AS counts ON true`;

export function servicesRouter(pool) {
    const router = Router();

    router.get('/', async (req, res) => {
        const includeQueue = req.query.includeQueue === '1';
        const [rows] = await pool.execute(
            `SELECT s.id, s.code, s.name, s.accepts_tokens AS "acceptsTokens",
                    s.default_service_seconds AS "defaultServiceSeconds"
                    ${includeQueue ? `, ${queueFields}` : ''}
             FROM services AS s
             ${includeQueue ? queueJoin : ''}
             WHERE s.accepts_tokens OR ?
             ORDER BY s.name, s.id`,
            [req.user.role === 'ADMIN'],
        );
        res.json({ data: rows.map((service) => ({ ...service, acceptsTokens: Boolean(Number(service.acceptsTokens)) })) });
    });

    router.get('/:id/queue', async (req, res) => {
        const serviceId = requireResourceId(req.params.id);
        const [[queue]] = await pool.execute(
            `SELECT s.id AS "serviceId", ${queueFields}
             FROM services AS s
             ${queueJoin}
             WHERE s.id = ? AND (s.accepts_tokens OR ?)`,
            [serviceId, req.user.role === 'ADMIN'],
        );
        if (!queue) {
            throw new HttpError(404, 'NOT_FOUND', 'Service was not found.');
        }
        res.json({ data: queue });
    });

    return router;
}
