# QueueWise project contributions

Campus service desks need to coordinate waiting students across multiple counters. Students need a token and visible queue position. Staff need to call the next student and record the outcome. Administrators need to configure service intake and assign staff.

The project succeeds when valid requests issue a token, repeated joins keep the same active token, staff can serve the oldest waiting token once, invalid transitions and restricted actions are rejected, and report totals can be checked against MySQL. [Testing evidence](testing-report.md) records which checks ran.

## Project-specific work

- The role-based campus workflow joins a student's token, a staff member's assigned counter, and an administrator's service configuration in one application.
- The queue design preserves FIFO across campus dates, prevents duplicate active tokens, and stores lifecycle changes with event history.
- The wait estimator uses counter availability, recent completed visits and a configurable fallback.
- Reporting views reconcile the operational data to wait, handling and staffed time. The Power BI report presents campus queue activity and counter performance.

These contributions describe what is implemented in the repository. Team members should confirm individual authorship and add any external assets or design sources they used before submission.

## Reused tools, assets, and AI

The project uses React, React Router, Vite, Tailwind CSS, Lucide icons, Inter, Express, mysql2, bcryptjs, MySQL, Playwright, Docker, and Power BI. Library versions are recorded in the package manifests and lockfiles. The login page uses a supplied campus image. Confirm its source and attribution before public distribution. The file-manager layout used a [Figma Community reference](https://www.figma.com/design/kasE4nTt1BTBTBJFipcVmv/File-Manager-Dashboard--Community-).

The SQL demo fixture and campus scenario scripts use synthetic records for testing and demonstrations. Codex helped with implementation, styling, documentation, test maintenance and review. The team should verify and explain the submitted work.

## Limitations and future work

The ETA model needs actual campus observations for accuracy claims. Power BI Desktop requires a local MySQL connection and refresh. Accessibility across assistive technologies and any hosted deployment need separate validation.
