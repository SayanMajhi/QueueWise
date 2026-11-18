# QueueWise live demo

**Story:** Sayan needs to get his marksheet verified. Meera operates the verification desk. The academic office coordinator wants to see whether the queue is moving. Show the same visit from all three accounts, then follow it into MySQL.

## Before the professor arrives

From the project folder, start the app and open <http://localhost:8080>.

```sh
docker compose up -d --build --wait
```

Use three separate browser profiles or browsers so each role stays signed in. These credentials are for the existing local demo database. A fresh database needs accounts and assignments created first. [Local setup](../README.md#run-locally)

| Role | Login ID | Password |
| --- | --- | --- |
| Student | `bt24csd028@iiitn.ac.in` | `student` |
| Admin | `admin` | `admin` |
| Staff | `meera.kulkarni` | `staff` |

Before presenting, check that Document Verification accepts tokens, Meera has a counter assigned, and you know which token is first in line. The demo database may already contain waiting or active visits. If the student's token is already waiting, use it and say so. If other tokens are ahead, rehearse on a clear demo queue or show the order as it stands. Avoid promising that your token will be called first.

## 1. Student — join a queue

**Do:** Sign in as Student. Under **Campus queues**, find **Document Verification** and select **Join queue**. Point to the token number, queue position, and estimated wait. Keep this window open.

**Say:** “I need to verify my marksheet. I choose Document Verification and get a token. This number identifies my visit. Position tells me where I am in line. The wait is an estimate and depends on how many desks are open and how quickly they serve people.”

## 2. Admin — show who runs the service

**Do:** Switch to the Admin profile and sign in. In **Operations overview**, show Document Verification under services, its counters, and Meera's assignment. Point to the live counts. If the service is paused or Meera is unassigned on your demo instance, enable intake or assign her before starting the student scene.

**Say:** “The office coordinator controls which services accept tokens and which staff member can operate a desk. Here Meera is assigned to the verification counter. The administrator sees the queue across services, while a student sees their own visit.”

## 3. Staff — call and serve the student

**Do:** Sign in as Staff. In **Counter workspace**, show the assigned desk and waiting list. Select **Open counter** if closed. If the desk already has a visit in progress, resolve it during rehearsal. Select **Call next token** when the desk is free. Check that the token displayed matches your student's token before switching to Student.

**Say:** “Staff do not need to guess who is next. The backend selects the oldest eligible waiting token. When I call it, the visit is assigned to my counter.”

**Do:** Return to Student and wait for the called status and counter name to appear. Switch back to Staff, select **Start service**, then **Complete service**.

**Say:** “The student now knows where to go. Meera checks the marksheet in person, then marks the visit complete. QueueWise records the visit and its outcome.”

## 4. Show the result

**Do:** In the Student window, open **Token history** and find the same token marked **Completed**. In Admin, show the change in today's completed count after the page updates.

**Say:** “This is the same token we issued. The Student view shows its final status and the Admin view shows the overall activity. The website updates both views by asking the API for the latest state.”

## 5. Show where the data is stored

**Say:** “The browser sends each action to the Express API. MySQL stores the student and staff accounts in `users`, the desk configuration in `services`, `counters`, and `staff_assignments`, and the daily token sequence in `queue_sessions`. The `tokens` table holds the current visit status. The `token_events` table records each transition, who performed it, and when. The backend saves the token change and its event in the same transaction.”

For a short database demonstration, open the MySQL client from the project folder. The command uses the credentials already configured inside the database container.

```sh
docker compose exec db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -u "$MYSQL_USER" "$MYSQL_DATABASE"'
```

Show the latest token for the demo student and its event history. If you rehearse multiple visits, match the service and issue time to the visit you just demonstrated.

```sql
SELECT t.id, s.name AS service, t.status, t.issued_at, t.completed_at
FROM tokens AS t
JOIN users AS u ON u.id = t.student_id
JOIN services AS s ON s.id = t.service_id
WHERE u.login = 'bt24csd028@iiitn.ac.in'
ORDER BY t.issued_at DESC
LIMIT 1;

SELECT from_status, to_status, event_at
FROM token_events
WHERE token_id = 'PASTE_TOKEN_ID_HERE'
ORDER BY id;
```

**Say:** “The first query shows where the visit ended. The second shows how it got there: Waiting, Called, In Service, and Completed.”

## 6. Close with Power BI and the takeaway

If you've rehearsed a working refresh, open [QueueWise-Manual.pbix](../analytics/powerbi/QueueWise-Manual.pbix) in Power BI Desktop, refresh, and select the demo date and service. Point to total or completed tokens. [Power BI setup and checks](../README.md#power-bi-desktop)

**Say:** “The website manages live queues. Power BI imports reporting views from the same MySQL database when we refresh. That lets the office review service demand, waiting time, and counter workload. We’ve shown one visit from joining the queue through service completion, student history, and the database record.”

## Panel questions and answers

**1. What problem does QueueWise solve?**  
“Students can check their place in a campus service queue and see which counter to visit. Staff call and serve students in order. Administrators control intake and staff assignments.”

**2. How do you decide who is called next?**  
“The backend selects the oldest eligible waiting token in that service. Counters assigned to the same service share its queue. Waiting tokens from an earlier day keep their place.”

**3. What happens if two staff members click Call next at the same time?**  
“The backend locks the service row in MySQL before selecting a token. The second request waits for the first transaction to finish, so both counters cannot claim the same token.”

**4. What if the student clicks Join twice?**  
“If the student already has an active token for that service, the server returns the existing token. A MySQL uniqueness constraint backs up that rule.”

**5. How is the waiting time calculated?**  
“We estimate time until the first call using the people ahead, which counters are open, and how long visits typically take. We use recent completed visits when there is enough history and a configured default when there isn't. With no open counter, the estimate is unavailable.”

**6. Where is the data stored, and why are there two token tables?**  
“MySQL stores the current status in `tokens` and the history of changes in `token_events`. The two changes commit together. If saving the event fails, the status change rolls back too.”

**7. How do you stop students from operating a counter?**  
“After sign-in, the API checks the user's session and role on protected requests. For staff actions it also checks the counter assignment. Hiding a button in the browser is only part of the interface.”

**8. What happens when an admin pauses intake?**  
“New students cannot join that service while intake is paused. Students who already have a token can still be called and served.”

**9. How does Power BI help, and does it update immediately?**  
“Power BI reads reporting views in MySQL. The separate Desktop file can show demand, wait times, and counter workload. The website shows current activity through the API. Power BI updates its imported snapshot when we refresh it.”

**10. How did you test it, and what still needs validation?**  
“The recorded audit passed 18 backend checks, one browser workflow through all three roles, and three SQL assertion scripts. We used a disposable database. The demo figures are test data. We still need campus observations to assess how accurate the wait estimates are in practice.”

**11. What did each person contribute?**  
“Sayan led the project and carried the larger share of the work. Piyush also contributed to the project.” Each presenter should then name a task they actually did, point to the file or evidence, and explain one decision they made.
