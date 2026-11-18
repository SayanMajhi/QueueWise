import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { chromium } from 'playwright-core';

const baseUrl = new URL(process.env.QUEUEWISE_E2E_URL || 'http://127.0.0.1:8080').origin;
const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };

function button(page, name) {
    return page.getByRole('button', { name, exact: true });
}

function heading(page, name) {
    return page.getByRole('heading', { name, exact: true });
}

function see(locator) {
    return locator.waitFor({ state: 'visible' });
}

function seeText(page, text) {
    return see(page.getByText(text, { exact: true }));
}

async function assertMobileLayout(page) {
    await page.setViewportSize(mobile);
    const layout = await page.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
    }));
    assert.ok(layout.content <= layout.viewport, `${page.url()} overflows its ${layout.viewport}px viewport`);
}

async function clickAndWaitForPost(page, control, pathname) {
    const [response] = await Promise.all([
        page.waitForResponse((reply) =>
            new URL(reply.url()).pathname === pathname && reply.request().method() === 'POST'),
        control.click(),
    ]);
    return response;
}

async function joinQueue(page, service) {
    const response = await clickAndWaitForPost(page, button(page, `Join queue for ${service}`), '/api/tokens');
    assert.equal(response.status(), 201, `Expected a new ${service} token`);
    return (await response.json()).data.tokenNumber;
}

test('student, staff, and administrator can complete their QueueWise workflows in Chromium', {
    timeout: 120_000,
}, async (t) => {
    const password = process.env.DEMO_PASSWORD;
    assert.ok(password, 'Set DEMO_PASSWORD for the demo accounts in your disposable database');
    const health = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(10_000) });
    assert.ok(health.ok, `QueueWise is not ready at ${baseUrl}`);

    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.CHROME_PATH || undefined,
    });
    t.after(() => browser.close());
    const pageErrors = [];

    async function signIn(login, viewport) {
        const page = await browser.newPage({ viewport });
        page.setDefaultTimeout(15_000);
        page.on('pageerror', (error) => pageErrors.push(`${login}: ${error.message}`));
        await page.goto(baseUrl);
        await page.getByRole('textbox', { name: 'Login ID', exact: true }).fill(login);
        await page.getByLabel('Password', { exact: true }).fill(password);
        const response = await clickAndWaitForPost(page, button(page, 'Sign in'), '/api/auth/login');
        assert.equal(response.status(), 200, `Demo login failed for ${login}`);
        return page;
    }

    const student = await signIn('demo.student.01', mobile);
    await see(heading(student, 'Campus queues'));
    await assertMobileLayout(student);
    await student.reload();
    await see(heading(student, 'Campus queues'));
    await student.keyboard.press('Tab');
    assert.equal(await student.locator('a.skip-link:focus').count(), 1, 'Tab should focus the skip link');
    await student.keyboard.press('Enter');
    assert.equal(await student.locator('main#content:focus').count(), 1, 'The skip link should focus the page contents');

    const completedToken = await joinQueue(student, 'Document Verification');
    await see(button(student, 'Cancel token'));

    const staff = await signIn('demo.staff.adm1', desktop);
    await see(heading(staff, 'Counter workspace'));
    await button(staff, 'Open counter').click();
    await seeText(student, '< 1 min');
    await button(staff, 'Call next token').click();
    await seeText(student, 'It’s your turn. Please proceed to Verification Desk 1 (ADM1).');
    await button(staff, 'Start service').click();
    await seeText(student, 'The counter is currently handling your request.');
    await button(staff, 'Complete service').click();

    await student.getByRole('link', { name: 'View history', exact: true }).click();
    await see(heading(student, 'Token history'));
    const completedRow = student.getByRole('row').filter({ hasText: completedToken });
    await seeText(completedRow, 'Completed');
    await assertMobileLayout(student);

    await student.getByRole('link', { name: 'My queue', exact: true }).click();
    const cancelledToken = await joinQueue(student, 'Hostel Administration');
    await button(student, 'Cancel token').click();
    const cancellation = student.getByRole('dialog', { name: 'Cancel this token?' });
    await button(cancellation, 'Cancel token').click();
    await seeText(student, 'Your token was cancelled.');
    const cancelledRow = student.getByRole('row').filter({ hasText: cancelledToken });
    await seeText(cancelledRow, 'Cancelled');

    const access = await student.request.get(`${baseUrl}/api/admin/overview`);
    assert.equal(access.status(), 403, 'A student should not have administrator access');

    const admin = await signIn('demo.admin', desktop);
    await see(heading(admin, 'Operations overview'));
    const serviceCode = `E2E${randomBytes(4).toString('hex').toUpperCase()}`;
    const serviceName = `Browser Check ${serviceCode}`;
    const counterName = `Browser Desk ${serviceCode}`;
    const updatedCounterName = `Updated Desk ${serviceCode}`;

    await button(admin, 'Add service').click();
    await admin.getByLabel('Service code').fill(serviceCode);
    await admin.getByLabel('Service name').fill(serviceName);
    await button(admin, 'Create service').click();
    await seeText(admin, 'Service added.');

    await button(admin, `Edit ${serviceName}`).click();
    await admin.getByLabel('Default service time (seconds)').fill('240');
    await button(admin, 'Save service').click();
    await seeText(admin, 'Service settings saved.');

    await button(admin, `Pause intake for ${serviceName}`).click();
    await button(admin.getByRole('dialog'), 'Pause intake').click();
    await button(admin, `Resume intake for ${serviceName}`).click();
    await see(button(admin, `Pause intake for ${serviceName}`));

    await button(admin, 'Add counter').click();
    await admin.getByLabel('Service', { exact: true }).selectOption({ label: serviceName });
    await admin.getByLabel('Counter code').fill('WEB1');
    await admin.getByLabel('Counter name').fill(counterName);
    await button(admin, 'Create counter').click();
    await seeText(admin, 'Counter added.');

    await button(admin, `Edit ${counterName}`).click();
    await admin.getByLabel('Counter name').fill(updatedCounterName);
    await button(admin, 'Save counter').click();
    await seeText(admin, 'Counter saved.');

    const hosStaff = 'demo.staff.hos1';
    await button(admin, `Change counter for ${hosStaff}`).click();
    await admin.getByLabel('Counter', { exact: true }).selectOption({ label: `${serviceName} · ${updatedCounterName}` });
    await button(admin, 'Save assignment').click();
    await seeText(admin, 'Staff assignment saved.');
    const assignmentRow = admin.getByRole('row').filter({ hasText: hosStaff });
    await see(assignmentRow.getByText(updatedCounterName));

    await button(admin, `Unassign ${hosStaff}`).click();
    await button(admin.getByRole('dialog'), 'Unassign').click();
    await seeText(admin, 'Staff assignment removed.');
    await seeText(assignmentRow, 'Unassigned');

    await button(admin, `Assign counter for ${hosStaff}`).click();
    await admin.getByLabel('Counter', { exact: true }).selectOption({ label: 'Hostel Administration · Hostel Desk' });
    await button(admin, 'Save assignment').click();
    await see(assignmentRow.getByText('Hostel Desk'));

    await button(admin, `Pause intake for ${serviceName}`).click();
    await button(admin.getByRole('dialog'), 'Pause intake').click();
    await see(button(admin, `Resume intake for ${serviceName}`));

    await button(staff, 'Close counter').click();
    await button(staff.getByRole('dialog', { name: 'Close this counter?' }), 'Close counter').click();
    await see(button(staff, 'Open counter'));

    await assertMobileLayout(admin);
    await assertMobileLayout(staff);
    await button(student, 'Sign out').click();
    await see(heading(student, 'Welcome back.'));
    assert.deepEqual(pageErrors, [], 'The app reported unexpected errors while running the workflows');
});
