import { Router } from 'express';
import { HttpError, invalidInput, requireResourceId, requireRole } from './http.js';
import { lockService, withTransaction } from './queue.js';

const serviceFields = 'id, code, name, accepts_tokens AS "acceptsTokens", default_service_seconds AS "defaultServiceSeconds"';
const counterFields = 'id, service_id AS "serviceId", code, name, status';

function readBody(body, allowedFields, { partial = false } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw invalidInput('Send a JSON object.');
    }
    const keys = Object.keys(body);
    if (keys.length === 0 || keys.some((key) => !allowedFields.includes(key))
        || (!partial && keys.length !== allowedFields.length)) {
        throw invalidInput(`Allowed fields: ${allowedFields.join(', ')}.`);
    }
    return body;
}

function validCode(value) {
    if (typeof value !== 'string' || !/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(value)) {
        throw invalidInput('Code must use 1–32 uppercase letters, digits, hyphens or underscores and start with a letter or digit.');
    }
    return value;
}

function validName(value) {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name || name.length > 120 || name.includes('\0')) {
        throw invalidInput('Name must contain 1–120 characters.');
    }
    return name;
}

function validDuration(value) {
    if (!Number.isInteger(value) || value < 1 || value > 2147483647) {
        throw invalidInput('Default service duration must be a positive number of whole seconds.');
    }
    return value;
}

function notFound(resource) {
    return new HttpError(404, 'NOT_FOUND', `${resource} was not found.`);
}

function duplicateCode(resource) {
    return new HttpError(409, 'DUPLICATE_CODE', `That ${resource} code is already in use.`);
}

function serviceDto(service) {
    return { ...service, acceptsTokens: Boolean(Number(service.acceptsTokens)) };
}

async function readService(db, serviceId) {
    const [[service]] = await db.execute(
        `SELECT ${serviceFields} FROM services WHERE id = ?`,
        [serviceId],
    );
    return serviceDto(service);
}

async function insertWithUniqueCode(db, resource, sql, values) {
    try {
        await db.execute(sql, values);
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            throw duplicateCode(resource);
        }
        throw error;
    }
    const [[{ id }]] = await db.query('SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id');
    return id;
}

async function readCounter(db, counterId) {
    const [[counter]] = await db.execute(
        `SELECT ${counterFields} FROM counters WHERE id = ?`,
        [counterId],
    );
    if (!counter) {
        throw notFound('Counter');
    }
    return counter;
}

async function checkCounterCoverage(db, counterId, staffId) {
    const [[counter]] = await db.execute(
        `SELECT (
             c.status IN ('OPEN', 'DRAINING') OR EXISTS (
                 SELECT 1 FROM tokens AS t
                 WHERE t.counter_id = c.id AND t.status IN ('CALLED', 'IN_SERVICE')
             )
         ) AND NOT EXISTS (
             SELECT 1 FROM staff_assignments AS a
             JOIN users AS u ON u.id = a.staff_id
             WHERE a.counter_id = c.id AND a.staff_id <> ? AND u.is_active AND u.role = 'STAFF'
         ) AS "requiresStaff"
         FROM counters AS c
         WHERE c.id = ?`,
        [staffId, counterId],
    );
    if (Number(counter.requiresStaff)) {
        throw new HttpError(409, 'COUNTER_REQUIRES_STAFF', 'This counter needs a staff member while open or serving a token.');
    }
}

async function changeAssignment(client, counterId, staffId, assign) {
    const [[staff]] = await client.execute(
        'SELECT role, is_active FROM users WHERE id = ?',
        [staffId],
    );
    if (!staff) {
        throw notFound('Staff account');
    }
    if (staff.role !== 'STAFF' || (assign && !Number(staff.is_active))) {
        throw invalidInput('Select a staff account that can receive this assignment.');
    }

    // Serialize staff moves without locking the user row used by token-event foreign keys.
    await client.execute(
        `INSERT INTO staff_assignment_guards (staff_id) VALUES (?)
         ON DUPLICATE KEY UPDATE staff_id = staff_id`,
        [staffId],
    );

    const target = await readCounter(client, counterId);
    const [[source]] = await client.execute(
        `SELECT c.id, c.service_id AS "serviceId"
         FROM staff_assignments AS a
         JOIN counters AS c ON c.id = a.counter_id
         WHERE a.staff_id = ?`,
        [staffId],
    );

    if (!assign && source?.id !== counterId) {
        return null;
    }
    if (assign && source?.id === counterId) {
        return { staffId, counterId };
    }

    const serviceIds = [target.serviceId];
    if (source && source.serviceId !== target.serviceId) {
        serviceIds.push(source.serviceId);
        serviceIds.sort((left, right) => BigInt(left) < BigInt(right) ? -1 : 1);
    }
    for (const serviceId of serviceIds) {
        await lockService(client, serviceId);
    }
    if (source) {
        await checkCounterCoverage(client, source.id, staffId);
    }

    if (!assign) {
        await client.execute(
            'DELETE FROM staff_assignments WHERE staff_id = ? AND counter_id = ?',
            [staffId, counterId],
        );
        return null;
    }

    await client.execute(
        `INSERT INTO staff_assignments (staff_id, counter_id) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE counter_id = ?`,
        [staffId, counterId, counterId],
    );
    return { staffId, counterId };
}

async function readOverview(client) {
    const [services] = await client.execute(
        `SELECT s.id, s.code, s.name, s.accepts_tokens AS "acceptsTokens",
                s.default_service_seconds AS "defaultServiceSeconds",
                coalesce(t.waiting, 0) AS waiting, coalesce(t.called, 0) AS called,
                coalesce(t.inService, 0) AS "inService", coalesce(c.openCounters, 0) AS "openCounters"
         FROM services AS s
         LEFT JOIN (
             SELECT service_id, CAST(count(CASE WHEN status = 'WAITING' THEN 1 END) AS DOUBLE) AS waiting,
                    CAST(count(CASE WHEN status = 'CALLED' THEN 1 END) AS DOUBLE) AS called,
                    CAST(count(CASE WHEN status = 'IN_SERVICE' THEN 1 END) AS DOUBLE) AS "inService"
             FROM tokens WHERE status IN ('WAITING', 'CALLED', 'IN_SERVICE')
             GROUP BY service_id
         ) AS t ON t.service_id = s.id
         LEFT JOIN (
             SELECT service_id, CAST(count(*) AS DOUBLE) AS "openCounters"
             FROM counters WHERE status = 'OPEN' GROUP BY service_id
         ) AS c ON c.service_id = s.id
         ORDER BY s.name, s.id`,
    );
    const [counters] = await client.execute(
        `SELECT ${counterFields} FROM counters ORDER BY service_id, name, id`,
    );
    const [staff] = await client.execute(
        `SELECT u.id, u.login, a.counter_id AS "counterId"
         FROM users AS u
         LEFT JOIN staff_assignments AS a ON a.staff_id = u.id
         WHERE u.role = 'STAFF' AND u.is_active
         ORDER BY u.login, u.id`,
    );
    const [[today]] = await client.execute(
        `WITH campus_day AS (
             SELECT date(UTC_TIMESTAMP(6) + interval 330 minute) AS campus_date
         ), bounds AS (
             SELECT campus_date - interval 330 minute AS start_at,
                    campus_date + interval 1 day - interval 330 minute AS end_at
             FROM campus_day
         )
         SELECT CAST(count(CASE WHEN issued_at >= start_at AND issued_at < end_at THEN 1 END) AS DOUBLE)
                    AS "issuedToday",
                CAST(count(CASE WHEN status = 'COMPLETED' AND completed_at >= start_at AND completed_at < end_at
                           THEN 1 END) AS DOUBLE) AS "completedToday"
         FROM tokens CROSS JOIN bounds
         WHERE (issued_at >= start_at AND issued_at < end_at)
            OR (status = 'COMPLETED' AND completed_at >= start_at AND completed_at < end_at)`,
    );
    const summary = { waiting: 0, called: 0, inService: 0, openCounters: 0, ...today };
    for (const service of services) {
        summary.waiting += service.waiting;
        summary.called += service.called;
        summary.inService += service.inService;
        summary.openCounters += service.openCounters;
    }
    return { services: services.map(serviceDto), counters, staff, summary };
}

export function adminRouter(pool, authenticate) {
    const router = Router();
    const adminOnly = [authenticate, requireRole('ADMIN')];

    router.get('/admin/overview', adminOnly, async (req, res) => {
        const data = await withTransaction(pool, readOverview, { readOnly: true });
        res.json({ data });
    });

    router.post('/services', adminOnly, async (req, res) => {
        const { code, name, defaultServiceSeconds } = readBody(req.body, ['code', 'name', 'defaultServiceSeconds']);
        const values = [validCode(code), validName(name), validDuration(defaultServiceSeconds)];
        const data = await withTransaction(pool, async (client) => {
            const id = await insertWithUniqueCode(client, 'service',
                'INSERT INTO services (code, name, default_service_seconds) VALUES (?, ?, ?)', values);
            return readService(client, id);
        });
        res.status(201).json({ data });
    });

    router.patch('/services/:id', adminOnly, async (req, res) => {
        const id = requireResourceId(req.params.id);
        const body = readBody(req.body, ['name', 'acceptsTokens', 'defaultServiceSeconds'], { partial: true });
        const name = Object.hasOwn(body, 'name') ? validName(body.name) : null;
        const duration = Object.hasOwn(body, 'defaultServiceSeconds') ? validDuration(body.defaultServiceSeconds) : null;
        if (Object.hasOwn(body, 'acceptsTokens') && typeof body.acceptsTokens !== 'boolean') {
            throw invalidInput('Accepts tokens must be true or false.');
        }

        const data = await withTransaction(pool, async (client) => {
            await lockService(client, id);
            await client.execute(
                `UPDATE services
                 SET name = coalesce(?, name), accepts_tokens = coalesce(?, accepts_tokens),
                     default_service_seconds = coalesce(?, default_service_seconds)
                 WHERE id = ?`,
                [name, body.acceptsTokens ?? null, duration, id],
            );
            return readService(client, id);
        });
        res.json({ data });
    });

    router.post('/counters', adminOnly, async (req, res) => {
        const body = readBody(req.body, ['serviceId', 'code', 'name']);
        const serviceId = requireResourceId(body.serviceId);
        const code = validCode(body.code);
        const name = validName(body.name);

        const data = await withTransaction(pool, async (client) => {
            await lockService(client, serviceId);
            const id = await insertWithUniqueCode(client, 'counter',
                'INSERT INTO counters (service_id, code, name) VALUES (?, ?, ?)', [serviceId, code, name]);
            return readCounter(client, id);
        });
        res.status(201).json({ data });
    });

    router.patch('/counters/:id', adminOnly, async (req, res) => {
        const id = requireResourceId(req.params.id, 'Counter ID');
        const { name } = readBody(req.body, ['name']);
        const trimmedName = validName(name);
        const data = await withTransaction(pool, async (client) => {
            const { serviceId } = await readCounter(client, id);
            await lockService(client, serviceId);
            await client.execute('UPDATE counters SET name = ? WHERE id = ?', [trimmedName, id]);
            return readCounter(client, id);
        });
        res.json({ data });
    });

    async function assignment(req, res) {
        const counterId = requireResourceId(req.params.id, 'Counter ID');
        const staffId = requireResourceId(req.params.staffId, 'Staff ID');
        const data = await withTransaction(pool, (client) =>
            changeAssignment(client, counterId, staffId, req.method === 'PUT'));
        res.json({ data });
    }

    router.put('/counters/:id/staff/:staffId', adminOnly, assignment);
    router.delete('/counters/:id/staff/:staffId', adminOnly, assignment);

    return router;
}
