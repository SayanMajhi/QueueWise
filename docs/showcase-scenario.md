# QueueWise: college office demonstration

Prepared on 17 November 2026. This is a fictional campus scenario using realistic Indian names and the college ID format supplied by the project owner. These are not verified students or employees; no emails are sent. The website uses natural service names and college-style login IDs. Keep this disclosure in the presentation methodology rather than presenting invented activity as measured college usage.

## 1. The story to tell

“Students need document verification, certificates for scholarship applications, and hostel assistance. Instead of waiting in a physical line, they take a token online. Office staff call and serve students in order. The administrator manages desks and intake. Power BI reads the recorded activity from MySQL so the office can understand demand, waiting times and completed work.”

QueueWise manages the queue for those requests. It does not upload documents, approve scholarships, issue certificates, allot hostel rooms, or send email. Those are the reasons for the visit, not extra software features.

Website: http://localhost:8080

## 2. Characters and working logins

### Administrator

Use **admin / admin**. In the story, the presenter plays Anita Joshi, the academic office coordinator. The separate `anita.joshi` account is the renamed previous showcase admin; use the verified `admin` login for the presentation.

### Office staff — password `staff` for every named staff login

| Name | Login | Assignment | Scenario |
| --- | --- | --- | --- |
| Meera Kulkarni | `meera.kulkarni` | Verification Desk 1 | Checks original marksheets and identity documents |
| Rajesh Deshmukh | `rajesh.deshmukh` | Verification Desk 2 | Helps handle the registration rush |
| Priya Sharma | `priya.sharma` | Certificates Desk | Handles bonafide and scholarship certificate requests |
| Amit Patil | `amit.patil` | Hostel Desk | Handles hostel fee receipt and administrative enquiries |

### Students — password `student` for every student login

| Name in the scenario | Roll number | Login/email | Reason for visiting |
| --- | --- | --- | --- |
| Aarav Sharma | BT24CSD028 | `bt24csd028@iiitn.ac.in` | Semester document verification |
| Ananya Deshmukh | BT24CSE014 | `bt24cse014@iiitn.ac.in` | Original marksheet verification |
| Rohan Verma | BT24CSA021 | `bt24csa021@iiitn.ac.in` | Scholarship certificate; returns with missing income certificate |
| Aditya Rao | BT24ECI009 | `bt24eci009@iiitn.ac.in` | Hostel query; misses his call because of a lab session |
| Nisha Patel | BT24CSH017 | `bt24csh017@iiitn.ac.in` | Document check currently being handled by Meera |
| Kunal Joshi | BT23CSD042 | `bt23csd042@iiitn.ac.in` | Hostel fee receipt verification |
| Isha Nair | BT25CSE006 | `bt25cse006@iiitn.ac.in` | Bonafide certificate for an education loan |
| Sneha Kulkarni | BT23CSA033 | `bt23csa033@iiitn.ac.in` | Academic document verification |

`BT24CSD028` means admission year 2024, branch CSD, roll sequence 028. Other branch codes use the supplied CSE, CSA, ECI and CSH formats. Login is the lowercase email, not the uppercase roll number. The app has no separate full-name or roll-number column: names above identify the characters for narration; the website displays their login IDs. Email-shaped logins do not imply that mailboxes exist.

The original `student / student` and `staff / staff` accounts remain available. Use named accounts above to demonstrate assigned desks and populated history. The original student still has an Admissions token; it was preserved.

## 3. What is already prepared

- 328 historical visits: the previous 28 plus 300 additional visits across ten weekdays between 2 and 16 November 2026.
- Earlier history remains on 27–28 October and 10 November 2026.
- All three demonstration services have completed and unsuccessful visits.
- Every historical visit has lifecycle events. Staffed desk intervals support counter-performance reports.
- Four counters are open.
- Nisha is **In service** at Verification Desk 1.
- Aarav and Ananya are waiting for document verification.
- Rohan is waiting at the certificate service after an earlier skipped visit.
- Kunal is waiting for hostel assistance.
- The original Admissions token remains waiting separately.

At preparation, the full database had **338 visits: 258 completed, 19 cancelled, 29 no-shows, 26 skipped, 5 waiting and 1 in service**. These totals change as you demonstrate the app. The historical dataset is illustrative, not a representative sample of actual campus usage. The eight characters recur throughout the history.

## 4. Prepare browser sessions

Use three separate browser profiles or different browsers:

1. Admin window: `admin / admin`.
2. Staff window: `meera.kulkarni / staff`.
3. Student window: `bt24csd028@iiitn.ac.in / student`.

Tabs in the same profile share login cookies. Two private windows can also share a session. Use separate profiles or browsers to avoid replacing another role's login.

The staged activity is a starting scene, not an automatic reset. If you already completed it, create another student visit and follow the same lifecycle. Live service time keeps increasing while a token remains in service; complete Nisha's visit when you start presenting, or finish it now and create a fresh visit on presentation day.

## 5. Main presentation: eight minutes

### Scene A — Anita opens the office (admin)

1. Open **Operations overview**.
2. Show the service list, live waiting counts, four open desks and today's issued/completed totals.
3. Show **Staff assignments** and explain which employee operates each desk.
4. Say: “Historical reports describe past work; this screen describes the queue right now.”

### Scene B — Aarav checks his place (student)

1. Sign in with Aarav's email and password `student`.
2. Show his active Document Verification token, position and estimated wait.
3. Open **Token history** and show previous completed visits.
4. Say: “The estimate can change when desks open or close and students are served. It is not an appointment time.”

Aarav already has a waiting token. Do not cancel it before the next scene.

### Scene C — Meera serves the queue (staff)

1. Sign in as `meera.kulkarni`.
2. Show Nisha's current **In service** token. Select **Complete service**.
3. Select **Call next token**. Aarav should be next unless somebody has used the queue since preparation.
4. In Aarav's browser, wait for the called status and assigned counter to appear.
5. As Meera, select **Start service**. Explain that she is checking his original marksheet in person.
6. Select **Complete service**.
7. Show Aarav's completed history entry and the administrator's changed totals.

### Scene D — Rajesh opens a second line (staff)

1. Sign in as `rajesh.deshmukh` in the staff window.
2. Verification Desk 2 is already open. Call the next token, normally Ananya.
3. Start and complete her visit.
4. Explain: “Both desks share the same service queue, and each handles one called or in-service student at a time.”

### Scene E — Rohan returns with the missing document

1. Sign in as `priya.sharma`.
2. Call Rohan's waiting certificate token.
3. Explain that his earlier visit was skipped because he lacked the income certificate.
4. Start and complete this visit after explaining that he has brought it now.
5. Sign in as Rohan to show both the skipped entry and the later completed entry in history. The skip reason is stored in token events; do not promise a reason display on every screen.

### Scene F — Show the result in Power BI

1. Open the report that successfully connects to the local MySQL database.
2. Refresh its imported data. Include **17 November 2026** when showing today's changes; on a later presentation date, include that date instead.
3. Show the increased completed count and changed token statuses.
4. Explain the connection: **website action → backend validation → MySQL records → Power BI refresh → updated charts**.

Open the report in Power BI Desktop and refresh it to import the latest activity. This scenario setup does not verify Desktop rendering or the previously reported black report window.

## 6. Short scenarios for the other controls

| Feature | Realistic reason | Actions and expected result |
| --- | --- | --- |
| Join a queue | Isha needs a loan bonafide certificate | Sign in as Isha, join the certificate service; receive a waiting token. If she already has one, use it. |
| Cancel | Isha realizes she has a lecture | Cancel her waiting token. History retains a cancelled visit. |
| Missing documents | Sneha forgot an original marksheet | Join verification as Sneha; staff calls the token, selects **Skip token**, enters “Original semester marksheet required”. Skip ends that visit; joining again creates a new visit. |
| No-show | Aditya is still in a lab | Join hostel as Aditya. Amit serves Kunal first if Kunal remains ahead, then calls Aditya and selects **Mark no-show**. |
| Pause/resume intake | Hostel office temporarily stops new requests | Admin pauses Hostel Administration. A student without an active hostel token cannot join. Admin resumes it. Existing tokens remain. |
| Close a free counter | Rajesh leaves for lunch | Finish his current visit, then close his counter. Open it again when he returns. |
| Close a busy counter | Meera must finish her current student before lunch | While a token is in service, close the counter. It becomes draining; completing the token closes it. Reopen afterwards. |
| Edit service | Office changes its initial handling-time assumption | Admin edits the service default duration, saves, then restores the original: verification 360, certificate 240, hostel 300 seconds. Historical estimates may still apply. |
| Edit counter | Desk signage is updated | Admin edits “Verification Desk 2” to “Verification Desk 2 — Academic Office”; save, then restore if desired. |
| Reassign staff | Rajesh covers the certificate desk | Close his free counter, admin changes his assignment to Certificates Desk. Show his staff screen, then restore Verification Desk 2 and reopen it. |
| Unassign | A staff member is off duty | Close their free counter, unassign in admin, show no assigned counter, then assign them back. The last staff member cannot leave an open/busy counter. |
| Add service | A new campus office starts accepting visits | Library Clearance already exists. Demonstrate the form without saving a duplicate; create another service only if needed. The app has no delete-service feature. |
| Add counter | Library needs another staffed desk | The Library Help Desk (`LIB1`) already exists. Demonstrate the form, or add a second desk only if needed and assign staff before operating it. |
| Sign out/access rules | Another person uses the workstation | Sign out; protected operations require a new login. Student accounts cannot perform staff/admin actions. |

Library Clearance and Fees and Accounts have now been added, each with 30 historical visits. They manage visit queues, not book inventory, clearance approval or payments.

## 7. Power BI presentation layout

For historical charts, use **27 October–16 November 2026** and services Document Verification, Bonafide and Scholarship Certificates, Hostel Administration. This excludes today's rapid walkthrough, whose seconds-long actions are not realistic measurements of office work. For the live update demonstration, switch the date filter to the presentation day.

Suggested report:

- Top: total visits, completed visits, average waiting minutes, average handling minutes.
- Middle: daily visit trend and completed visits by service.
- Bottom: outcome counts, demand by arrival hour, and counter performance.
- Slicers: date and service.

Use the existing views `vw_token_lifecycle`, `vw_daily_service_summary`, `vw_hourly_queue_demand`, `vw_counter_performance`, `vw_services` and `vw_counters`. Calculate overall averages from lifecycle rows or weight summary averages by their appropriate sample counts; averaging daily averages equally can mislead. Do not sum snapshot data from multiple views together as if they were separate visits.

For the current report, see the [Power BI Desktop guide](../README.md#power-bi-desktop).

## 8. Verification and repeatability

Verified through the running API on 17 November 2026:

- Admin, all four named staff, all eight named students, and original student/staff login successfully.
- Paused intake rejects a new request; resume restores intake.
- Staff unassignment and reassignment work.
- Counter open, call, start, complete, draining close and reopening work.
- Rejoining the same active service returns the existing token.
- Cancellation, skip with a reason, no-show and student history work.
- All tokens have an event matching their current status.
- MySQL reporting views return populated data: 40 daily-service rows and 53 counter-performance rows at verification.

These were API/database checks, not browser-click or screenshot verification. Add/edit service and counter controls are documented above but were not exercised during this preparation. Power BI Desktop refresh and rendering still require verification on your machine.

The one-off scenario script added 300 historical visits to the existing showcase data and was archived during repository cleanup. The figures below describe the previously prepared demo database. For a fresh setup, follow the [README](../README.md#run-locally).


## 9. Expanded campus services — six total

Added after the initial snapshot above:

| Service | Counter | Staff login | Password | Student scenario |
| --- | --- | --- | --- | --- |
| Library Clearance | Library Help Desk (`LIB1`) | `sunita.nair` | `staff` | Sneha needs library clearance before collecting academic documents. Sunita Nair checks her return status in person. |
| Fees and Accounts | Accounts Desk (`FEE1`) | `vikram.joshi` | `staff` | Isha needs a verified semester fee receipt for her education loan. Vikram Joshi checks the payment reference in person. |

The complete service list is Admissions, Document Verification, Bonafide and Scholarship Certificates, Hostel Administration, Library Clearance, and Fees and Accounts. Admissions retains its earlier paused state. The two new desks are open and ready for students to join.

For each new service, sign in as the student, join its queue, then use the assigned staff login to call, start and complete the visit. Library missing-document example: “Return the outstanding library book before clearance.” Accounts example: “Bank payment reference required to verify the fee receipt.” These are in-person scenarios, not implemented book-return or payment features.

Each new service has 30 historical visits across 2–16 November 2026: 27 completed, one cancelled, one skipped and one no-show. The combined historical dataset is now 388 visits. Refresh Power BI and include LIB/FEE in service filters to show them. The earlier snapshot totals are retained above as preparation-time figures.

The one-off service setup script was archived during repository cleanup. Both staff logins and counter opening were verified through the running API during demo preparation.
