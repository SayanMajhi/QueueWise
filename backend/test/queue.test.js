import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';

import bcrypt from 'bcryptjs';

import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { createPool } from '../src/db.js';

async function expectData(response, status = 200) {
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    assert.ok(Object.hasOwn(body, 'data'));
    return body.data;
}

async function expectError(response, status) {
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    assert.ok(body.error?.code);
}

async function createFixture(t) {
    const { database } = readConfig();
    assert.match(database.database, /_test$/, 'Use a disposable database whose name ends with _test');
    const pool = createPool(database);
    const suffix = randomBytes(5).toString('hex');
    const serviceCodes = [];
    const logins = [];
    const log = { error() {} };
    const server = createApp({ pool, log }).listen(0, '127.0.0.1');
    t.after(async () => {
        try {
            await new Promise((resolve, reject) => {
                server.close((error) => error ? reject(error) : resolve());
            });
            const [rows] = serviceCodes.length ? await pool.query(
                'SELECT id FROM services WHERE code IN (?)',
                [serviceCodes],
            ) : [[]];
            const serviceIds = rows.map(({ id }) => id);
            if (serviceIds.length) {
                await pool.query(`
                    DELETE FROM token_events
                    WHERE token_id IN (SELECT id FROM tokens WHERE service_id IN (?))
                `, [serviceIds]);
                await pool.query('DELETE FROM tokens WHERE service_id IN (?)', [serviceIds]);
                await pool.query('DELETE FROM queue_sessions WHERE service_id IN (?)', [serviceIds]);
                await pool.query(`
                    DELETE FROM staff_assignments
                    WHERE counter_id IN (SELECT id FROM counters WHERE service_id IN (?))
                `, [serviceIds]);
                await pool.query(`
                    DELETE FROM counter_availability
                    WHERE counter_id IN (SELECT id FROM counters WHERE service_id IN (?))
                `, [serviceIds]);
                await pool.query('DELETE FROM counters WHERE service_id IN (?)', [serviceIds]);
                await pool.query('DELETE FROM services WHERE id IN (?)', [serviceIds]);
            }
            if (logins.length) await pool.query('DELETE FROM users WHERE login IN (?)', [logins]);
        } finally {
            await pool.end();
        }
    });
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}/api`;
    const password = randomBytes(20).toString('hex');
    const hash = await bcrypt.hash(password, 10);

    function request(path, { method = 'GET', user, body } = {}) {
        const headers = {};
        if (user) headers.Cookie = user.cookie;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        return fetch(`${origin}${path}`, { method, headers, body: JSON.stringify(body) });
    }

    async function account(name, role, counterId) {
        const login = `queue-test.${suffix}.${name}`;
        logins.push(login);
        const [{ insertId }] = await pool.execute(
            'INSERT INTO users (login, password_hash, role) VALUES (?, ?, ?)',
            [login, hash, role],
        );
        const id = String(insertId);
        if (counterId) {
            await pool.query(
                'INSERT INTO staff_assignments (staff_id, counter_id) VALUES (?, ?)',
                [id, counterId],
            );
        }
        const response = await request('/auth/login', { method: 'POST', body: { login, password } });
        await expectData(response);
        return { id, cookie: response.headers.get('set-cookie').split(';')[0] };
    }

    function serviceCode(name) {
        const code = `QT${suffix.toUpperCase()}_${name}`;
        serviceCodes.push(code);
        return code;
    }

    async function service(name, acceptsTokens = true) {
        const code = serviceCode(name);
        const [{ insertId }] = await pool.execute(`
            INSERT INTO services (code, name, default_service_seconds, accepts_tokens)
            VALUES (?, 'Queue integration fixture', 180, ?)
        `, [code, acceptsTokens]);
        return { id: String(insertId), code };
    }

    async function counter(serviceId, code) {
        const [{ insertId }] = await pool.execute(
            "INSERT INTO counters (service_id, code, name) VALUES (?, ?, 'Queue integration fixture')",
            [serviceId, code],
        );
        return { id: String(insertId), code };
    }

    function post(path, user, body) {
        return request(path, { method: 'POST', user, body });
    }

    function issue(serviceId, user) {
        return post('/tokens', user, { serviceId });
    }

    function counterAction(counterId, action, user) {
        return post(`/counters/${counterId}/${action}`, user);
    }

    function tokenAction(tokenId, action, user, body) {
        return post(`/tokens/${tokenId}/${action}`, user, body);
    }

    return { pool, request, account, service, serviceCode, counter, issue, counterAction, tokenAction };
}

const options = {
    skip: process.env.QUEUEWISE_TEST_DB !== '1' && 'Set QUEUEWISE_TEST_DB=1 for a disposable migrated *_test database',
    timeout: 45_000,
};

test('issuance is idempotent, cancellations preserve history, and students see their own tokens', options, async (t) => {
    const { pool, request, account, service, issue, tokenAction } = await createFixture(t);
    const enabled = await service('ISSUE');
    const disabled = await service('DISABLED', false);
    const student = await account('issuer', 'STUDENT');
    const other = await account('nonowner', 'STUDENT');
    const staff = await account('wrong-role', 'STAFF');

    const responses = await Promise.all([issue(enabled.id, student), issue(enabled.id, student)]);
    assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 201]);
    const [token, repeated] = await Promise.all(responses.map((response) => expectData(response, response.status)));
    assert.equal(repeated.id, token.id);
    assert.equal(token.status, 'WAITING');
    assert.equal(token.serviceId, enabled.id);
    assert.equal(token.position, 1);
    assert.equal(token.sequence, 1);
    assert.equal(token.tokenNumber, `${enabled.code}-${token.queueDate.replaceAll('-', '')}-001`);
    assert.equal(token.estimateSeconds, null);
    assert.equal(token.estimateBasis, 'UNAVAILABLE');
    assert.equal((await expectData(await request('/tokens', { user: student })))[0].id, token.id);
    assert.deepEqual(await expectData(await request('/tokens', { user: other })), []);
    assert.equal((await expectData(await request(`/tokens/${token.id}`, { user: student }))).id, token.id);
    await expectError(await request(`/tokens/${token.id}`, { user: other }), 404);
    await expectError(await tokenAction(token.id, 'cancel', other), 404);
    await expectError(await request(`/tokens/${randomUUID()}`, { user: student }), 404);
    await expectError(await issue(enabled.id, staff), 403);
    await expectError(await issue(disabled.id, student), 409);
    await expectError(await issue('9223372036854775807', student), 404);
    await expectError(await issue('bad-id', student), 400);

    const cancelled = await expectData(await tokenAction(token.id, 'cancel', student));
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.position, null);
    assert.ok(cancelled.closedAt);
    await expectError(await tokenAction(token.id, 'cancel', student), 409);
    const replacement = await expectData(await issue(enabled.id, student), 201);
    assert.notEqual(replacement.id, token.id);
    if (replacement.queueDate === token.queueDate) assert.equal(replacement.sequence, 2);
    const [events] = await pool.query(`
        SELECT actor_id, from_status, to_status FROM token_events WHERE token_id = ? ORDER BY id
    `, [token.id]);
    assert.deepEqual(events, [
        { actor_id: student.id, from_status: null, to_status: 'WAITING' },
        { actor_id: student.id, from_status: 'WAITING', to_status: 'CANCELLED' },
    ]);
});

test('concurrent calls preserve FIFO across dates and counter draining preserves active service', options, async (t) => {
    const { pool, request, account, service, counter, issue, counterAction, tokenAction } = await createFixture(t);
    const main = await service('MAIN');
    const other = await service('OTHER');
    const firstCounter = await counter(main.id, 'A');
    const secondCounter = await counter(main.id, 'B');
    const otherCounter = await counter(other.id, 'A');
    const student = await account('student', 'STUDENT');
    const previousStudent = await account('previous', 'STUDENT');
    const firstStaff = await account('first-staff', 'STAFF', firstCounter.id);
    const secondStaff = await account('second-staff', 'STAFF', secondCounter.id);
    const otherStaff = await account('other-staff', 'STAFF', otherCounter.id);

    const olderId = randomUUID();
    const [{ insertId: oldSessionId }] = await pool.execute(`
        INSERT INTO queue_sessions (service_id, queue_date, last_sequence)
        VALUES (?, DATE(UTC_TIMESTAMP() + INTERVAL 330 MINUTE) - INTERVAL 1 DAY, 1)
    `, [main.id]);
    await pool.execute(`
        INSERT INTO tokens (id, student_id, service_id, queue_session_id, sequence, issued_at)
        SELECT ?, ?, ?, id, 1, TIMESTAMP(queue_date, '18:29:00') FROM queue_sessions WHERE id = ?
    `, [olderId, previousStudent.id, main.id, oldSessionId]);
    await pool.execute(`
        INSERT INTO token_events (token_id, actor_id, event_at, to_status)
        SELECT id, ?, issued_at, 'WAITING' FROM tokens WHERE id = ?
    `, [previousStudent.id, olderId]);
    const current = await expectData(await issue(main.id, student), 201);
    const independent = await expectData(await issue(other.id, student), 201);
    assert.equal(current.position, 2);
    assert.equal(independent.position, 1);

    const assigned = await expectData(await request('/staff/counters', { user: firstStaff }));
    assert.deepEqual(assigned.map(({ id }) => id), [firstCounter.id]);
    await expectError(await request('/staff/counters', { user: student }), 403);
    await expectError(await request(`/counters/${secondCounter.id}/queue`, { user: firstStaff }), 403);
    await expectError(await counterAction(firstCounter.id, 'call-next', firstStaff), 409);

    const counters = [
        { ...firstCounter, staff: firstStaff },
        { ...secondCounter, staff: secondStaff },
        { ...otherCounter, staff: otherStaff },
    ];
    const opened = await Promise.all(counters.map(({ id, staff }) => counterAction(id, 'open', staff)));
    for (const response of opened) assert.equal((await expectData(response)).status, 'OPEN');

    const queue = await expectData(await request(`/counters/${firstCounter.id}/queue`, { user: firstStaff }));
    assert.equal(queue.currentToken, null);
    assert.deepEqual(queue.waiting.map(({ id }) => id), [olderId, current.id]);
    const calls = await Promise.all([
        counterAction(firstCounter.id, 'call-next', firstStaff),
        counterAction(secondCounter.id, 'call-next', secondStaff),
        counterAction(otherCounter.id, 'call-next', otherStaff),
        counterAction(otherCounter.id, 'call-next', otherStaff),
    ]);
    const [first, second] = await Promise.all(calls.slice(0, 2).map((response) => expectData(response)));
    assert.deepEqual(new Set([first.id, second.id]), new Set([olderId, current.id]));
    assert.equal(first.counterId, firstCounter.id);
    assert.equal(second.counterId, secondCounter.id);
    const [callEvents] = await pool.query(`
        SELECT token_id FROM token_events
        WHERE token_id IN (?) AND to_status = 'CALLED' ORDER BY id
    `, [[olderId, current.id]]);
    assert.deepEqual(callEvents.map(({ token_id: id }) => id), [olderId, current.id]);
    assert.deepEqual(calls.slice(2).map(({ status }) => status).sort(), [200, 409]);
    for (const response of calls.slice(2)) {
        if (response.status === 200) {
            assert.equal((await expectData(response)).id, independent.id);
        } else {
            await expectError(response, 409);
        }
    }

    const [olderCounter, currentCounter] = first.id === olderId ? counters : [counters[1], counters[0]];
    await expectError(await tokenAction(olderId, 'start', currentCounter.staff), 403);
    await expectError(await tokenAction(olderId, 'complete', olderCounter.staff), 409);
    await expectError(await tokenAction(current.id, 'cancel', student), 409);
    assert.equal((await expectData(await tokenAction(olderId, 'start', olderCounter.staff))).status, 'IN_SERVICE');
    assert.equal((await expectData(await counterAction(olderCounter.id, 'close', olderCounter.staff))).status, 'DRAINING');
    await expectError(await counterAction(olderCounter.id, 'call-next', olderCounter.staff), 409);
    const completed = await expectData(await tokenAction(olderId, 'complete', olderCounter.staff));
    assert.equal(completed.status, 'COMPLETED');
    assert.equal(completed.completedAt, completed.closedAt);
    assert.ok(completed.startedAt);
    const drained = await expectData(await request(`/counters/${olderCounter.id}/queue`, { user: olderCounter.staff }));
    assert.equal(drained.counter.status, 'CLOSED');
    assert.equal(drained.currentToken, null);
    const [availability] = await pool.query(`
        SELECT opened_at, closed_at FROM counter_availability WHERE counter_id = ?
    `, [olderCounter.id]);
    assert.equal(availability.length, 1);
    assert.ok(availability[0].closed_at >= availability[0].opened_at);

    await expectError(await tokenAction(current.id, 'skip', currentCounter.staff, { reason: '  ' }), 400);
    assert.equal((await expectData(await tokenAction(current.id, 'skip', currentCounter.staff, {
        reason: 'Student asked to return later',
    }))).status, 'SKIPPED');
    assert.equal((await expectData(await tokenAction(independent.id, 'no-show', otherStaff))).status, 'NO_SHOW');
    assert.equal(await expectData(await counterAction(currentCounter.id, 'call-next', currentCounter.staff)), null);

    const [events] = await pool.query(`
        SELECT token_id, to_status, reason FROM token_events
        WHERE token_id IN (?) ORDER BY id
    `, [[olderId, current.id, independent.id]]);
    function statuses(tokenId) {
        return events.filter(({ token_id: id }) => id === tokenId).map(({ to_status: status }) => status);
    }
    assert.deepEqual(statuses(olderId), ['WAITING', 'CALLED', 'IN_SERVICE', 'COMPLETED']);
    assert.deepEqual(statuses(current.id), ['WAITING', 'CALLED', 'SKIPPED']);
    assert.deepEqual(statuses(independent.id), ['WAITING', 'CALLED', 'NO_SHOW']);
    assert.equal(events.find(({ to_status: status }) => status === 'SKIPPED').reason, 'Student asked to return later');
});

test('an event write failure rolls back the call and leaves the token eligible', options, async (t) => {
    const { pool, request, account, service, counter, issue, counterAction } = await createFixture(t);
    const queue = await service('ROLLBACK');
    const desk = await counter(queue.id, 'A');
    const staff = await account('staff', 'STAFF', desk.id);
    const student = await account('student', 'STUDENT');
    await expectData(await counterAction(desk.id, 'open', staff));
    const token = await expectData(await issue(queue.id, student), 201);
    // Occupy the unique event slot so the real event INSERT fails inside call-next.
    await pool.execute(
        `INSERT INTO token_events (token_id, actor_id, from_status, to_status, reason)
         VALUES (?, ?, 'WAITING', 'CALLED', 'Injected duplicate event')`,
        [token.id, staff.id],
    );
    try {
        await expectError(await counterAction(desk.id, 'call-next', staff), 500);
        const afterFailure = await expectData(await request(`/tokens/${token.id}`, { user: student }));
        assert.equal(afterFailure.status, 'WAITING');
        assert.equal(afterFailure.counterId, null);
        assert.equal(afterFailure.calledAt, null);
        const [events] = await pool.execute(
            'SELECT to_status, reason FROM token_events WHERE token_id = ? ORDER BY id',
            [token.id],
        );
        assert.deepEqual(events, [
            { to_status: 'WAITING', reason: null },
            { to_status: 'CALLED', reason: 'Injected duplicate event' },
        ]);
    } finally {
        await pool.execute("DELETE FROM token_events WHERE token_id = ? AND reason = 'Injected duplicate event'", [token.id]);
    }
    assert.equal((await expectData(await counterAction(desk.id, 'call-next', staff))).id, token.id);
});

test('live wait follows queue and counter changes while the issuance estimate stays fixed', options, async (t) => {
    const { pool, request, account, service, counter, issue, counterAction, tokenAction } = await createFixture(t);
    const queue = await service('ESTIMATE');
    const desk = await counter(queue.id, 'A');
    const extraDesk = await counter(queue.id, 'B');
    const staff = await account('staff-a', 'STAFF', desk.id);
    const extraStaff = await account('staff-b', 'STAFF', extraDesk.id);
    const firstStudent = await account('first', 'STUDENT');
    const secondStudent = await account('second', 'STUDENT');
    const thirdStudent = await account('third', 'STUDENT');

    const first = await expectData(await issue(queue.id, firstStudent), 201);
    assert.equal(first.estimatedWaitSeconds, null);
    assert.equal(first.estimatedWaitBasis, 'UNAVAILABLE');
    await expectData(await counterAction(desk.id, 'open', staff));
    const nowOpen = await expectData(await request(`/tokens/${first.id}`, { user: firstStudent }));
    assert.equal(nowOpen.estimatedWaitSeconds, 0);
    assert.equal(nowOpen.estimatedWaitBasis, 'DEFAULT');
    assert.equal(nowOpen.estimateSeconds, null);
    assert.equal(nowOpen.estimateBasis, 'UNAVAILABLE');

    assert.equal((await expectData(await counterAction(desk.id, 'call-next', staff))).id, first.id);
    const second = await expectData(await issue(queue.id, secondStudent), 201);
    assert.equal(second.estimateSeconds, 180);
    assert.equal(second.estimateBasis, 'DEFAULT');
    assert.equal(second.estimatedWaitSeconds, 180);

    await expectData(await counterAction(extraDesk.id, 'open', extraStaff));
    const [listed] = await expectData(await request('/tokens', { user: secondStudent }));
    assert.equal(listed.estimatedWaitSeconds, 0);
    const repeated = await expectData(await issue(queue.id, secondStudent));
    assert.equal(repeated.id, second.id);
    assert.equal(repeated.estimateSeconds, 180);
    assert.equal(repeated.estimatedWaitSeconds, 0);
    await expectData(await counterAction(extraDesk.id, 'close', extraStaff));

    assert.equal((await expectData(await counterAction(desk.id, 'close', staff))).status, 'DRAINING');
    const noCapacity = await expectData(await request(`/tokens/${second.id}`, { user: secondStudent }));
    assert.equal(noCapacity.estimatedWaitSeconds, null);
    assert.equal(noCapacity.estimateSeconds, 180);
    await expectData(await tokenAction(first.id, 'no-show', staff));

    // The oldest of 31 completions is an outlier and should fall outside the window.
    const [{ insertId: historySession }] = await pool.execute(
        "INSERT INTO queue_sessions (service_id, queue_date, last_sequence) VALUES (?, '2020-01-02', 31)",
        [queue.id],
    );
    await pool.execute(`
        INSERT INTO tokens (
            student_id, service_id, queue_session_id, sequence, status, counter_id,
            issued_at, called_at, started_at, completed_at, closed_at
        )
        WITH RECURSIVE numbers(n) AS (
            SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 31
        ), history AS (
            SELECT n, TIMESTAMP('2020-01-01 18:30:00') + INTERVAL (n * 30) MINUTE AS issued_at,
                   IF(n = 1, 900, 60) AS duration FROM numbers
        )
        SELECT ?, ?, ?, n, 'COMPLETED', ?, issued_at, issued_at, issued_at,
               issued_at + INTERVAL duration SECOND, issued_at + INTERVAL duration SECOND
        FROM history
    `, [firstStudent.id, queue.id, historySession, desk.id]);

    await expectData(await counterAction(desk.id, 'open', staff));
    const third = await expectData(await issue(queue.id, thirdStudent), 201);
    assert.equal(third.position, 2);
    assert.equal(third.estimateSeconds, 60);
    assert.equal(third.estimateBasis, 'HISTORICAL');
    assert.equal(third.estimatedWaitSeconds, 60);

    await expectData(await tokenAction(second.id, 'cancel', secondStudent));
    const nowFirst = await expectData(await request(`/tokens/${third.id}`, { user: thirdStudent }));
    assert.equal(nowFirst.estimateSeconds, 60);
    assert.equal(nowFirst.estimatedWaitSeconds, 0);
    await expectData(await counterAction(desk.id, 'call-next', staff));

    const called = await expectData(await request(`/tokens/${third.id}`, { user: thirdStudent }));
    assert.equal(called.status, 'CALLED');
    assert.equal(called.estimateSeconds, 60);
    assert.equal(called.estimatedWaitSeconds, null);
    assert.ok(Date.parse(called.calledAt) >= Date.parse(called.issuedAt));
});

test('administrators manage service intake and counter coverage on MySQL', options, async (t) => {
    const { request, account, serviceCode, issue, counterAction, tokenAction } = await createFixture(t);
    const admin = await account('admin', 'ADMIN');
    const staff = await account('staff', 'STAFF');
    const replacement = await account('replacement', 'STAFF');
    const student = await account('student', 'STUDENT');
    const code = serviceCode('MANAGEMENT');
    const createService = { code, name: 'New service', defaultServiceSeconds: 180 };

    await expectError(await request('/admin/overview', { user: student }), 403);
    for (const body of [
        { code, name: 'Missing duration' },
        { ...createService, defaultServiceSeconds: '180' },
        { ...createService, name: 'a'.repeat(121) },
    ]) {
        await expectError(await request('/services', { method: 'POST', user: admin, body }), 400);
    }
    const service = await expectData(await request('/services', {
        method: 'POST', user: admin, body: createService,
    }), 201);
    await expectError(await request('/services', {
        method: 'POST', user: admin, body: createService,
    }), 409);
    assert.equal(service.acceptsTokens, true);
    const desk = await expectData(await request('/counters', {
        method: 'POST', user: admin, body: { serviceId: service.id, code: 'A', name: 'First desk' },
    }), 201);
    const renamed = await expectData(await request(`/counters/${desk.id}`, {
        method: 'PATCH', user: admin, body: { name: 'Student desk' },
    }));
    assert.equal(renamed.name, 'Student desk');

    const firstAssignment = `/counters/${desk.id}/staff/${staff.id}`;
    const secondAssignment = `/counters/${desk.id}/staff/${replacement.id}`;
    await expectData(await request(firstAssignment, { method: 'PUT', user: admin }));
    await expectData(await counterAction(desk.id, 'open', staff));
    const waiting = await expectData(await issue(service.id, student), 201);
    await expectData(await request(`/services/${service.id}`, {
        method: 'PATCH', user: admin, body: { acceptsTokens: false },
    }));
    assert.equal((await expectData(await issue(service.id, student))).id, waiting.id);
    assert.equal((await expectData(await counterAction(desk.id, 'call-next', staff))).id, waiting.id);

    await expectError(await request(firstAssignment, { method: 'DELETE', user: admin }), 409);
    await expectData(await request(secondAssignment, { method: 'PUT', user: admin }));
    await expectData(await request(firstAssignment, { method: 'DELETE', user: admin }));
    await expectError(await tokenAction(waiting.id, 'start', staff), 403);
    await expectData(await tokenAction(waiting.id, 'start', replacement));
    await expectData(await tokenAction(waiting.id, 'complete', replacement));

    const overview = await expectData(await request('/admin/overview', { user: admin }));
    assert.equal(overview.services.find(({ id }) => id === service.id)?.acceptsTokens, false);
    assert.equal(overview.staff.find(({ id }) => id === replacement.id)?.counterId, desk.id);
    assert.ok(overview.summary.completedToday >= 1);
    const resumed = await expectData(await request(`/services/${service.id}`, {
        method: 'PATCH', user: admin, body: { acceptsTokens: true },
    }));
    assert.equal(resumed.acceptsTokens, true);
    await expectData(await issue(service.id, student), 201);
});
