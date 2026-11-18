import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';

import bcrypt from 'bcryptjs';

import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createPool } from '../src/db.js';

async function startApi(t, options) {
    const server = createApp(options).listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    }));

    const origin = `http://127.0.0.1:${server.address().port}`;
    return (path, options) => fetch(`${origin}/api${path}`, options);
}

function postJson(body, headers = {}) {
    return {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
    };
}

async function expectError(response, status, code) {
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.error.code, code);
    assert.equal(typeof body.error.message, 'string');
    assert.ok(body.error.message);
}

async function expectData(response, status = 200) {
    assert.equal(response.status, status);
    const body = await response.json();
    assert.ok(Object.hasOwn(body, 'data'));
    return body.data;
}

test('configuration rejects missing credentials and invalid ports', () => {
    assert.throws(() => readConfig({}), /MYSQL_PASSWORD/);
    assert.throws(() => readConfig({ MYSQL_PASSWORD: 'test', API_PORT: '65536' }), /API_PORT/);
    assert.throws(() => readConfig({ MYSQL_PASSWORD: 'test', MYSQL_PORT: '5433a' }), /MYSQL_PORT/);
    const config = readConfig({
        MYSQL_PASSWORD: 'test',
        MYSQL_PORT: '5434',
        API_PORT: '3001',
        NODE_ENV: 'production',
    });
    assert.equal(config.database.port, 5434);
    assert.equal(config.port, 3001);
    assert.equal(config.secureCookies, true);
});

test('health reports a database outage without leaking the driver error', async (t) => {
    const pool = {
        async query() {
            throw new Error('private database connection details');
        },
    };
    const request = await startApi(t, { pool, log: { error() {} } });
    const response = await request('/health');
    const copy = response.clone();
    await expectError(response, 503, 'DATABASE_UNAVAILABLE');
    assert.doesNotMatch(await copy.text(), /private database connection details/);
});

const runDatabaseTest = process.env.QUEUEWISE_TEST_DB === '1';
test('authentication, service permissions, and queue counts against MySQL', {
    skip: runDatabaseTest ? false : 'Set QUEUEWISE_TEST_DB=1 and point database configuration at a disposable migrated database',
    timeout: 30_000,
}, async (t) => {
    const { database } = readConfig();
    assert.match(database.database, /_test$/, 'API tests require a disposable database whose name ends with _test');
    const pool = createPool(database);
    const prefix = `API_TEST_${randomBytes(6).toString('hex').toUpperCase()}`;
    const accounts = {
        student: { login: `${prefix.toLowerCase()}.student`, role: 'STUDENT', active: true },
        staff: { login: `${prefix.toLowerCase()}.staff`, role: 'STAFF', active: true },
        admin: { login: `${prefix.toLowerCase()}.admin`, role: 'ADMIN', active: true },
        disabled: { login: `${prefix.toLowerCase()}.disabled`, role: 'STUDENT', active: false },
    };
    const serviceCodes = [`${prefix}_MAIN`, `${prefix}_OTHER`, `${prefix}_DISABLED`];
    const password = randomBytes(24).toString('hex');
    const passwordHash = await bcrypt.hash(password, 10);

    t.after(async () => {
        try {
            const logins = Object.values(accounts).map(({ login }) => login);
            await pool.query(`
                DELETE FROM tokens
                WHERE service_id IN (SELECT id FROM services WHERE code IN (?))
            `, [serviceCodes]);
            await pool.query(`
                DELETE FROM queue_sessions
                WHERE service_id IN (SELECT id FROM services WHERE code IN (?))
            `, [serviceCodes]);
            await pool.query('DELETE FROM staff_assignments WHERE staff_id = ?', [accounts.staff.id ?? null]);
            await pool.query(`
                DELETE FROM counter_availability
                WHERE counter_id IN (
                    SELECT c.id FROM counters AS c
                    JOIN services AS s ON s.id = c.service_id WHERE s.code IN (?)
                )
            `, [serviceCodes]);
            await pool.query(`
                DELETE FROM counters
                WHERE service_id IN (SELECT id FROM services WHERE code IN (?))
            `, [serviceCodes]);
            await pool.query('DELETE FROM services WHERE code IN (?)', [serviceCodes]);
            await pool.query('DELETE FROM users WHERE login IN (?)', [logins]);
        } finally {
            await pool.end();
        }
    });

    for (const account of Object.values(accounts)) {
        const [result] = await pool.execute(
            'INSERT INTO users (login, password_hash, role, is_active) VALUES (?, ?, ?, ?)',
            [account.login, passwordHash, account.role, account.active],
        );
        account.id = String(result.insertId);
    }

    const [main, other, disabled] = await Promise.all([
        ['API Test Main', 180, true], ['API Test Other', 240, true], ['API Test Disabled', 300, false],
    ].map(async ([name, duration, enabled], index) => {
        const code = serviceCodes[index];
        const [{ insertId }] = await pool.execute(
            'INSERT INTO services (code, name, accepts_tokens, default_service_seconds) VALUES (?, ?, ?, ?)',
            [code, name, enabled, duration],
        );
        return { id: String(insertId), code };
    }));
    const [{ insertId: counterId }] = await pool.execute(
        "INSERT INTO counters (service_id, code, name, status) VALUES (?, 'A1', 'API Test Counter', 'OPEN')",
        [main.id],
    );
    await pool.execute(
        'INSERT INTO counter_availability (counter_id, opened_at) VALUES (?, UTC_TIMESTAMP(6))',
        [counterId],
    );
    await pool.execute(
        'INSERT INTO staff_assignments (staff_id, counter_id) VALUES (?, ?)',
        [accounts.staff.id, counterId],
    );

    const request = await startApi(t, { pool, secureCookies: true });

    function accountData({ id, login, role }) {
        return { id, login, role };
    }

    async function login(account) {
        const response = await request('/auth/login', postJson({ login: account.login, password }));
        assert.deepEqual(await expectData(response), accountData(account));
        const cookie = response.headers.get('set-cookie');
        assert.match(cookie, /^queuewise_session=[^;]+/);
        assert.match(cookie, /; HttpOnly/i);
        assert.match(cookie, /; SameSite=Strict/i);
        assert.match(cookie, /; Secure(?:;|$)/i);
        return { Cookie: cookie.split(';')[0] };
    }

    await t.test('health and unauthenticated routes', async () => {
        assert.deepEqual(await expectData(await request('/health')), { status: 'ok' });
        await expectError(await request('/auth/me'), 401, 'UNAUTHENTICATED');
        await expectError(await request('/auth/me', {
            headers: { Cookie: `queuewise_session=${randomBytes(32).toString('base64url')}` },
        }), 401, 'UNAUTHENTICATED');
        await expectError(await request('/services'), 401, 'UNAUTHENTICATED');
        await expectError(await request(`/services/${main.id}/queue`), 401, 'UNAUTHENTICATED');
    });

    await t.test('login rejects invalid input, bad credentials, and disabled accounts', async () => {
        await expectError(
            await request('/auth/login', postJson({ login: accounts.student.login })),
            400,
            'INVALID_INPUT',
        );
        await expectError(await request('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{',
        }), 400, 'INVALID_JSON');
        await expectError(await request('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: 'plaintext',
        }), 415, 'UNSUPPORTED_MEDIA_TYPE');
        await expectError(
            await request('/auth/login', postJson({ login: 'a'.repeat(17_000), password })),
            413,
            'PAYLOAD_TOO_LARGE',
        );
        await expectError(await request('/auth/login', postJson({
            login: accounts.student.login,
            password: 'incorrect-password',
        })), 401, 'INVALID_CREDENTIALS');
        await expectError(
            await request('/auth/login', postJson({ login: accounts.disabled.login, password })),
            401,
            'INVALID_CREDENTIALS',
        );
    });

    await t.test('student sees enabled services and valid queue counts, then logs out', async () => {
        const headers = await login(accounts.student);
        assert.deepEqual(await expectData(await request('/auth/me', { headers })), accountData(accounts.student));
        const services = await expectData(await request('/services', { headers }));
        assert.deepEqual(services.find(({ id }) => id === main.id), {
            id: main.id,
            code: main.code,
            name: 'API Test Main',
            acceptsTokens: true,
            defaultServiceSeconds: 180,
        });
        assert.ok(services.some(({ id }) => id === other.id));
        assert.ok(services.every(({ id }) => id !== disabled.id));
        const queue = await expectData(await request(`/services/${main.id}/queue`, { headers }));
        assert.deepEqual(queue, { serviceId: main.id, waiting: 0, called: 0, inService: 0, openCounters: 1 });
        await expectError(await request('/services/not-a-number/queue', { headers }), 400, 'INVALID_INPUT');
        await expectError(await request('/services/9223372036854775808/queue', { headers }), 400, 'INVALID_INPUT');
        await expectError(await request('/services/9223372036854775807/queue', { headers }), 404, 'NOT_FOUND');
        await expectError(await request(`/services/${disabled.id}/queue`, { headers }), 404, 'NOT_FOUND');

        const response = await request('/auth/logout', { method: 'POST', headers });
        assert.equal(await expectData(response), null);
        assert.match(response.headers.get('set-cookie'), /^queuewise_session=;/);
        await expectError(await request('/auth/me', { headers }), 401, 'UNAUTHENTICATED');
    });

    await t.test('expired sessions and newly disabled accounts lose access', async () => {
        const studentHeaders = await login(accounts.student);
        const token = studentHeaders.Cookie.slice('queuewise_session='.length);
        const digest = createHash('sha256').update(token).digest('hex');
        const [updated] = await pool.execute(
            "UPDATE auth_sessions SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE token_hash = ?",
            [digest],
        );
        assert.equal(updated.affectedRows, 1);
        await expectError(await request('/auth/me', { headers: studentHeaders }), 401, 'UNAUTHENTICATED');

        const newHeaders = await login(accounts.student);
        await pool.query('UPDATE users SET is_active = false WHERE id = ?', [accounts.student.id]);
        try {
            await expectError(await request('/auth/me', { headers: newHeaders }), 401, 'UNAUTHENTICATED');
        } finally {
            await pool.query('UPDATE users SET is_active = true WHERE id = ?', [accounts.student.id]);
        }
    });

    await t.test('staff sees enabled queue totals and admin also sees disabled services', async () => {
        const staffHeaders = await login(accounts.staff);
        await expectData(await request(`/services/${main.id}/queue`, { headers: staffHeaders }));
        await expectData(await request(`/services/${other.id}/queue`, { headers: staffHeaders }));
        await expectError(await request(`/services/${disabled.id}/queue`, { headers: staffHeaders }), 404, 'NOT_FOUND');

        const adminHeaders = await login(accounts.admin);
        const services = await expectData(await request('/services', { headers: adminHeaders }));
        assert.equal(services.find(({ id }) => id === disabled.id)?.acceptsTokens, false);
        const queue = await expectData(await request(`/services/${disabled.id}/queue`, { headers: adminHeaders }));
        assert.equal(queue.openCounters, 0);
    });

    await t.test('queue totals count active tokens only within the requested service', async () => {
        const [{ insertId: sessionId }] = await pool.execute(
            "INSERT INTO queue_sessions (service_id, queue_date, last_sequence) VALUES (?, '2026-01-12', 3)",
            [main.id],
        );
        await pool.execute(`
            INSERT INTO tokens
                (student_id, service_id, queue_session_id, sequence, status,
                 counter_id, issued_at, called_at, closed_at)
            VALUES (?, ?, ?, 1, 'WAITING', NULL, '2026-01-12 03:30:00', NULL, NULL),
                   (?, ?, ?, 2, 'CALLED', ?, '2026-01-12 03:30:00', '2026-01-12 03:31:00', NULL),
                   (?, ?, ?, 3, 'CANCELLED', NULL, '2026-01-12 03:30:00', NULL, '2026-01-12 03:31:00')
        `, [
            accounts.student.id, main.id, sessionId,
            accounts.disabled.id, main.id, sessionId, counterId,
            accounts.student.id, main.id, sessionId,
        ]);
        const headers = await login(accounts.student);
        const mainQueue = await expectData(await request(`/services/${main.id}/queue`, { headers }));
        assert.deepEqual(mainQueue, {
            serviceId: main.id, waiting: 1, called: 1, inService: 0, openCounters: 1,
        });
        const catalog = await expectData(await request('/services?includeQueue=1', { headers }));
        const service = catalog.find(({ id }) => id === main.id);
        assert.equal(service.waiting, mainQueue.waiting);
        assert.equal(service.called, mainQueue.called);
        assert.equal(service.inService, mainQueue.inService);
        assert.equal(service.openCounters, mainQueue.openCounters);
        const otherQueue = await expectData(await request(`/services/${other.id}/queue`, { headers }));
        assert.deepEqual(otherQueue, {
            serviceId: other.id, waiting: 0, called: 0, inService: 0, openCounters: 0,
        });
    });
});
