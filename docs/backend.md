# QueueWise backend

Use Node.js 24 and a MySQL database with the QueueWise migrations applied. For local use, copy `.env.example` to `.env`, choose a MySQL password, and follow [the database setup guide](database.md) to start and migrate the database. Then run `npm --prefix backend ci` and `npm --prefix backend start` from the project root. Create accounts with `npm --prefix backend run account:create -- ADMIN admin --generate-password` or the corresponding role and login.

The server loads the project-root `.env` if present. Environment variables already set in the shell take precedence. The defaults use database host `127.0.0.1`, port `3307`, user and database `queuewise`, and API address `127.0.0.1:3000`. `MYSQL_PASSWORD` is required. Setting `NODE_ENV=production` requires HTTPS for the session cookie.

## Implemented endpoints

| Method and path | Behavior |
|---|---|
| `GET /api/health` | Reports readiness when the database is reachable and the session migration has been applied. Returns 503 otherwise. |
| `POST /api/auth/login` | Accepts a JSON object with `login` and `password`. Returns the account's ID, login and role and sets the session cookie. |
| `GET /api/auth/me` | Returns the signed-in account's ID, login and role. |
| `POST /api/auth/logout` | Revokes the current session in MySQL, clears the cookie and returns `data: null`. |
| `GET /api/services` | Returns services accepting tokens. Add `?includeQueue=1` for live counts and open-counter availability. Administrators also see disabled services. |
| `GET /api/services/:id/queue` | Returns `serviceId`, `waiting`, `called`, `inService`, and `openCounters`. A disabled service is available here to an administrator. |
| `GET /api/tokens`, `GET /api/tokens/:id` | List or retrieve the signed-in student's tokens. |
| `POST /api/tokens` | Accepts `{ "serviceId": "1" }`. Returns 201 for a new token or 200 with an existing active token. |
| `POST /api/tokens/:id/cancel` | Cancels the student's own waiting token. |
| `GET /api/staff/counters`, `GET /api/counters/:id/queue` | Show staff their assigned counter and its current token and waiting list. The waiting list contains display tokens and timing, with no student account fields. |
| `POST /api/counters/:id/open`, `POST /api/counters/:id/close` | Start or end staffed availability. Closing a busy counter sets it to `DRAINING` until its current token is resolved. |
| `POST /api/counters/:id/call-next` | Assigns the oldest waiting token to an open, idle counter. Returns `data: null` if the queue is empty. |
| `POST /api/tokens/:id/{start,complete,skip,no-show}` | Advances a token at the assigned staff member's counter. Skip requires `{ "reason": "..." }`. |
| `GET /api/admin/overview` | Returns queue counts by service, today's campus-local issuance and completions, counters, and staff assignments. Administrator only. |
| `POST /api/services`, `PATCH /api/services/:id` | Create or edit a service and pause or resume token intake. Service code stays fixed. Administrator only. |
| `POST /api/counters`, `PATCH /api/counters/:id` | Create a counter for a service or edit its name. Counter code and service stay fixed. Administrator only. |
| `PUT /api/counters/:id/staff/:staffId`, `DELETE /api/counters/:id/staff/:staffId` | Assign, move, or remove a staff member. Removing the last active assignee of an open or busy counter returns 409. Administrator only. |

Successful responses have a `data` field. Errors bind a stable `code` and user-facing `message` inside `error`. Database identifiers are JSON strings to preserve MySQL bigint precision.

Sessions expire after eight hours. The browser cookie is HTTP-only and SameSite Strict, and MySQL stores a SHA-256 digest of its random token. Passwords are checked against bcrypt hashes. Session lookups verify that the account is still active and use its current role. The API uses relative paths under `/api` so the frontend can share its origin when integrated.

## Queue behavior

A display number such as `ADM-20261117-004` combines the service code, campus-local issue date and daily sequence. The queue retains older waiting tickets across midnight. Position is one-based and appears while a token is waiting. Student token responses include a current `estimatedWaitSeconds` and `estimatedWaitBasis`. Display the wait as approximate and show **Estimate unavailable** when a waiting token has no open counters. Once the token leaves the waiting queue, the live wait has no value. Called tokens include the assigned counter name and code for display. The existing `estimateSeconds` and `estimateBasis` fields are the snapshot recorded at issuance, and are preserved on a repeated join or later poll.

Token and counter changes take the service row lock first. Call-next reads the oldest waiting token after obtaining that lock, then writes the assignment and lifecycle event in one transaction. A failed event write rolls back the assignment as well. Counter queue reads return the counter and token list from one database snapshot. Staff access uses assignments already in MySQL.

## Waiting-time model

QueueWise predicts time to first call. It averages the latest 30 completed handling durations for the service using `completed_at − started_at`. With fewer than five completions, it uses the service's configured default. Cancellations, skips, and no-shows contribute no handling durations.

Each open counter has a projected availability time. An idle counter is available now, a called token reserves a full typical handling duration, and a token in service reserves the typical duration less elapsed time, with a zero floor. The estimator assigns each older waiting token to the counter projected to free first. The next projected free time is the estimate, rounded up to a whole second. Closed and draining counters are excluded from new assignments and from the estimate.

Run [the SQL accuracy report](../analytics/validation/eta_accuracy.sql) against a migrated database to compare issuance estimates with actual `called_at − issued_at`. Use the service totals and basis breakdown to compare default and historical predictions. The report shows estimate coverage, comparable coverage, mean absolute error, and signed bias (estimate minus actual). Error metrics use only records with both values and return blank when there are no comparable calls. Accuracy of the current model on campus requires observed waits with estimates generated by the running application.

## Verify the API

Run `npm --prefix backend test` for the database-free checks. To include database integration tests, set `QUEUEWISE_TEST_DB=1` and point the `MYSQL_*` variables at a fresh, migrated MySQL database with a name ending in `_test`. The integration suite creates its own accounts and service fixtures, including a duplicate event to test rollback, so it needs only the migrations. For example, with the connection variables already set in your shell:

```sh
QUEUEWISE_TEST_DB=1 npm --prefix backend test
```
