# QueueWise testing report

Tests used Node.js 24.19.0 on Windows, Chrome, Docker Desktop, and MySQL 8.4. Compose project `queuewise-audit-final` used a separate volume, database `queuewise_audit_test`, app port 18089 and MySQL port 13389.

| Case | Expected | Actual |
|---|---|---|
| [Authentication, permissions and health](../backend/test/api.test.js) | Login restores the session, logout invalidates it, and unauthorized, disabled and expired sessions are rejected. An unavailable database yields 503 without exposing driver details. | Passed, including incorrect passwords, malformed and oversized bodies and out-of-range IDs. |
| [Issuance and cancellation](../backend/test/queue.test.js#L145) | Two simultaneous joins for the same service return one new token and one repeat. Owners see their position and history. Invalid or repeated cancellation fails. | Passed. Statuses were 200 and 201 with the same token ID. Cancellation returned a closed token and repeat cancellation was rejected. |
| [Concurrent staff calls and rollback](../backend/test/queue.test.js#L192) | Staff see assigned counters, older tickets are called first, each token transitions once, and an empty queue yields null. Failed event writes leave the token available. | Passed across dates, simultaneous calls, draining, completion, skip, no-show, and injected event failure. |
| [Wait estimates](../backend/test/estimates.test.js) and queue integration | No open counters produces an unavailable estimate. Capacity changes update the live estimate while preserving issuance history. | Passed, including default versus historical estimates and queue position updates. |
| [Admin management](../backend/test/queue.test.js#L421) | Admin can create services and counters, pause and resume intake, and assign or unassign staff. Invalid values and non-admin access are rejected. | Passed, including missing duration, wrong type, 121-character name, coverage checks, counter edits and successful issuance after resume. |
| [Chromium smoke test](../tests/e2e/smoke.test.js) | All three roles can complete the demonstration. Main content fits the narrow viewport, the skip link works, and no unhandled page errors occur. | One test passed. Covered 1440 px and 390 px widths, reload, keyboard skip-link focus, service completion, cancellation, admin editing and sign-out. The baseline failed on the stale sign-out heading expectation. The updated selectors passed. |
| [Database and reporting SQL](../analytics/validation/reporting.sql) | Constraints hold and reporting views match operational rows and known fixture totals, including midnight rollover. | Passed the constraints, demo, and reporting scripts. Fixture results were 28 tokens, 22 completed, 218.400 seconds average wait, and 276.818 seconds average handling. |
| [ETA diagnostic](../analytics/validation/eta_accuracy.sql) | Produce coverage and error statistics on rows with both an estimate and a call time. | Ran successfully. The synthetic fixture had 25 comparable of 28 tokens, 66.00 seconds mean absolute error and −63.60 seconds signed bias. These are fixture results only. |
| Power BI report | Project and theme files resolve, and rendered results match MySQL. | JSON parsed and registered theme paths resolved. Desktop opening, DAX evaluation, refresh and chart comparison remain unverified. |

## Commands executed

- `docker.exe --context desktop-linux compose -p queuewise-audit-final up -d --no-build --wait` started the isolated stack and applied migrations. The first attempt used default ports because Windows Docker did not inherit the shell variables. Passing the variables through WSLENV resolved the port conflict.
- `docker.exe --context desktop-linux build -t queuewise-audit-final:verification .` succeeded using cached layers.
- `node.exe frontend/node_modules/vite/bin/vite.js build frontend` produced the frontend bundle. The frontend has no standalone test script.
- `node.exe --test backend/test/*.test.js` passed all 18 checks with `QUEUEWISE_TEST_DB=1` and the isolated database settings. Reran after adding validation assertions.
- With database integration disabled, the same command passed six database-free checks and skipped six integration entry points as expected.
- `node.exe backend/src/seed.js` loaded the synthetic fixture. The MySQL client then ran `database/tests/constraints.sql`, `database/tests/demo.sql`, `analytics/validation/reporting.sql`, and `analytics/validation/eta_accuracy.sql`.
- `node.exe --test tests/e2e/smoke.test.js` passed with `QUEUEWISE_E2E_URL` targeting the isolated app, the fixture password in `DEMO_PASSWORD`, and `CHROME_PATH` pointing to Chrome.

## Remaining validation

After the website cleanup, the Vite production build passed, all 18 backend checks passed against the disposable MySQL database, and the Chromium smoke test passed against the rebuilt Docker image. The smoke test covered Student, Staff, and Admin workflows. Desktop reporting verification remains a separate check.

Check the signed-in empty database experience, tablet layout, complete keyboard and screen reader behavior, and a Power BI Desktop refresh against matching MySQL date filters. Run [hosted CI](../.github/workflows) after the submission repository is prepared. There was no load benchmark or campus user study in this audit.
