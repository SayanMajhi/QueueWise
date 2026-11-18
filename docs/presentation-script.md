# QueueWise presentation script

**Presenters:** Sayan Majhi (BT24CSD028) and Piyush Manglam (BT24CSD032)  
**Course:** Tools and Practice for Data Science · **Faculty guide:** Prof. Santosh Kumar Sahu

**Institution:** Indian Institute of Information Technology Nagpur

Aim for about eight minutes, including a short live demo. Sayan presents slides 1–5 and 7. Piyush presents slides 6, 8 and 9. This is a suggested speaking order.

## 1. Project Title · Sayan

“Good morning, Professor. I’m Sayan Majhi, and this is Piyush Manglam. Our project is QueueWise, a queue management system for campus service desks. We’ll show what a student sees, how staff handle the next token, and how the same records can be analyzed in Power BI.”

## 2. Problem Statement · Sayan

“Imagine a student arriving for document verification. They need to know how many people are ahead and which counter to go to. The staff member needs to know who is next, and the administrator needs to know which desks are available. QueueWise gives all three roles a shared view of the queue.”

## 3. Objectives and Scope · Sayan

“We set goals we could demonstrate. A student should get one active token per service, staff should be able to call and complete it, and the student should see the outcome in history. We also check that duplicate requests and unauthorized actions are handled. The system coordinates visits. The staff still perform the verification or other campus service in person.”

## 4. Existing Solutions · Sayan

“A physical line and paper tokens give people an order at the desk. A spreadsheet can record visits afterward. We wanted students and staff to see the same state as the visit happens. Our contribution combines that shared view with rules for who can change a token and an event history of what happened.”

## 5. Proposed System · Sayan

“Follow the top row of the diagram. React sends a request to Express. Express checks the session, role, and requested action. MySQL stores the new token state and its event in one transaction. The lower row is our Business Intelligence work. Power BI Desktop reads the reporting views and imports a snapshot on refresh. The four project areas are the React interface, Express and MySQL, local build and verification with Docker and CI configuration, and the separate Power BI report.”

**Hand-off:** “Piyush will now show that flow from the user’s side.”

## 6. Implementation and Demonstration · Piyush

“We have three workspaces. The administrator configures services and staff assignments. A student can join a service and see their token. Staff can open their assigned counter and move the token through the visit.”

1. **Admin:** Show a prepared service and its staff assignment.
2. **Staff:** Open that counter. Use a service with an empty waiting list if possible.
3. **Student:** Select **Join queue**. Point to the token, position, and estimated wait.
4. **Staff:** Select **Call next token**. In the Student tab, show the named counter when the status updates. Then start and complete service.
5. **Student:** Open token history and point to **Completed**. Return to the slides.

Say at the handoff: “That completed row is the same token we issued, with its final state now recorded.” Use the genuine screenshots on slide 6 if the live instance is unavailable. Open the separate PBIX only if you have checked refresh before presenting.

## 7. Testing and Results · Sayan

“We tested the rules as well as the happy path. Repeated joins should reuse one active token. Concurrent calls should avoid double assignment. If writing the event fails, the token change should roll back. The recorded audit had 18 passing backend checks, one passing three-role browser test, and three passing SQL assertion scripts. The 28 issued and 22 completed tokens shown here are from a test fixture. They demonstrate reconciliation, not campus adoption. Power BI Desktop refresh is still a separate check.”

## 8. Application of Project · Piyush

“Document verification, hostel help, library clearance, and fee enquiries can all use this workflow. Administrators can configure each service and its desks. Students can follow their progress, and staff can work through the eligible tokens in order.”

## 9. Conclusion and Future Scope · Piyush

“QueueWise takes a service request from token issuance to a recorded outcome. The most important things to validate next are wait estimates during real campus activity, report refresh against matching MySQL filters, and accessibility across more devices. Thank you. We’re ready for questions.”

## Questions to rehearse

- **How do you stop two staff members from calling the same token?** The API locks the service row before it selects the eligible waiting token and commits the change and event together.
- **How do you estimate the wait?** The app uses open counters, their current workload, and typical service times. If history is sparse it uses a configured duration. With no eligible counter it shows that an estimate is unavailable.
- **Why use MySQL and Power BI separately?** MySQL records actions as they happen. Power BI reads reporting views to calculate demand, waits, and counter workload from an imported snapshot.
- **What did each member contribute?** State the agreed 70% Sayan and 30% Piyush split if asked. Each person should prepare one or two tasks they actually did and identify a file, test, or other record they can explain.
