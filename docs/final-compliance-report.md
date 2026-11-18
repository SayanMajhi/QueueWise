# QueueWise final compliance report

**Readiness: READY WITH LIMITATIONS.** The local application passed the frontend build, MySQL-backed API tests, and Chromium demonstration. Power BI Desktop refresh and the Git submission still need a final check.

| Guideline | Status | Evidence | Missing items | Required fix |
|---|---|---|---|---|
| 1. Meaningful problem | PASS | [Project overview](../README.md) connects campus desk queues with students' need to see their place and staff's need to call in order. The browser test exercises that handoff. | Campus adoption was outside this audit. | None for the local project. |
| 2. Clear objective | PASS | [Objectives](project-contributions.md) and [acceptance checks](testing-report.md) identify users and success criteria. | Campus wait reduction has not been measured. | None for the functional objective. |
| 3. Four-module mapping | PASS | The module table below maps all four areas to implementation and evidence. | BI runtime evidence is pending. | Attach a refreshed report comparison. |
| 4. Manageable scope | PASS | The three role workspaces completed the core queue workflow on an isolated stack. | None observed in the core workflow. | None. |
| 5. Design before implementation | PARTIAL | [Architecture](system-architecture.md), [database design](database.md) and the [project guide](../README.md#how-queuewise-works) document the system. | No dated evidence establishes which designs preceded implementation. | Include original dated design artifacts if available. |
| 6. Original contribution | PARTIAL | [Contributions](project-contributions.md) distinguishes project-specific design, dependencies, fixtures, and AI assistance. | Individual authorship and any additional reused assets need team confirmation. | Confirm attribution before submission. |
| 7. Test with evidence | PARTIAL | 18 backend checks, one Chromium workflow, three SQL assertion scripts, and the ETA query ran successfully. See [testing evidence](testing-report.md). | DAX output and rendered values have not been reconciled in Desktop. | Refresh and compare totals and at least two counters with SQL. |
| 8. Usability | PARTIAL | [Setup](../README.md), role workflows, validation feedback and 390 px overflow checks were exercised. | Full accessibility and Power BI usability are unverified. | Run a manual keyboard review and verify Desktop access. |

## Four-module coverage

| Module | Concepts and implementation | Status and demonstration |
|---|---|---|
| 1. Business Intelligence | Standalone academic deliverable: MySQL reporting views in [003_reporting.sql](../database/migrations/003_reporting.sql), SQL checks in [analytics/validation](../analytics/validation), and the two-page [Power BI Desktop project](../analytics/powerbi/QueueWise-Manual.pbix). | **PARTIAL.** SQL facts reconciled against operational records. Desktop opening, refresh, and displayed values are **NOT VERIFIED**. See the [Desktop verification guide](../README.md#power-bi-desktop). |
| 2. Frontend Development | [App.jsx](../frontend/src/App.jsx) handles session and role routing. Student, Staff, and Admin JSX provide polling, forms, state-dependent controls and feedback. | **PASS for tested flows.** Build and Chromium workflow passed. Show issuance, staff handoff, history and admin controls. Tablet and full accessibility coverage remain unverified. |
| 3. Backend and Database | Express [app.js](../backend/src/app.js), session middleware, service-row serialization in [queue.js](../backend/src/queue.js), lifecycle handlers, and MySQL [constraints](../database/migrations/001_initial.sql). | **PASS for tested flows.** Show ordered calls and lifecycle states. The API suite verified concurrent requests, rollback and role boundaries. |
| 4. Development and Deployment | [Dockerfile](../Dockerfile), [Compose](../docker-compose.yml), migrations, environment example and [GitHub workflows](../.github/workflows). | **PARTIAL.** Local Docker build and isolated startup passed. Git has no commits, and hosted CI and cloud deployment were not verified. Prepare the submission snapshot and verify CI only if publishing is in scope. |

## Remaining issues and verification

- The historical campus scenario scripts configure predictable demo passwords and assume a prior showcase dataset. Keep those accounts confined to a local demo. For a fresh setup, create accounts with generated passwords or use the isolated CI fixture described in the testing guide.
- The counter chart filter path was corrected in the semantic model. Power BI Desktop still needs to load it and reconcile the results with the supplied SQL.
- Confirm the team and asset attribution, collect dated design evidence if available, and prepare the Git submission snapshot. The local checkout has no commits. Hosted CI and cloud deployment remain unverified.

## Demo order

1. Start Docker Compose and show the site on localhost. Sign in as admin and show services, counters and staff assignments.
2. Assign a staff account to a counter. Sign in as that staff member in a separate browser profile and open the counter.
3. In another profile, sign in as a student and join the service queue. Show the token, position and wait estimate.
4. Call the next token as staff. Show the notification in the student's view, then start and complete the service.
5. Open student history and admin totals. For an exception, issue a second token and cancel it while waiting.
6. Open Power BI Desktop separately, refresh the PBIX, clear slicers, and compare total and completed tokens with the [SQL check](../README.md#verify-a-report-number). Open Counter Efficiency and compare two counters.
