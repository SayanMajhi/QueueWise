-- Run with mysql batch mode against a disposable database containing only the demo seed.
-- A failing assertion aborts the script with a check violation at that statement.
CREATE TEMPORARY TABLE reporting_checks (
    test_case VARCHAR(100) NOT NULL,
    passed BOOLEAN NOT NULL CHECK (passed = 1)
);

START TRANSACTION READ ONLY;

INSERT INTO reporting_checks
SELECT 'Demo lifecycle totals',
       COUNT(*) = 28
       AND COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) = 22
       AND COUNT(wait_seconds) = 25
       AND ROUND(AVG(wait_seconds), 3) = 218.400
       AND ROUND(AVG(handling_seconds), 3) = 276.818
FROM vw_token_lifecycle;

INSERT INTO reporting_checks
WITH ranked AS (
    SELECT wait_seconds, ROW_NUMBER() OVER (ORDER BY wait_seconds) AS sample_number
    FROM vw_token_lifecycle WHERE wait_seconds IS NOT NULL
)
SELECT 'Campus P90 for 25 wait samples',
       COUNT(*) = 2 AND MIN(wait_seconds) = 420 AND MAX(wait_seconds) = 420
FROM ranked
WHERE sample_number IN (22, 23);

INSERT INTO reporting_checks
SELECT 'Lifecycle facts match each operational token',
       (SELECT COUNT(*) FROM vw_token_lifecycle) = (SELECT COUNT(*) FROM tokens)
       AND NOT EXISTS (
           SELECT 1
           FROM tokens AS t
           LEFT JOIN vw_token_lifecycle AS report ON report.token_id = t.id
           WHERE report.token_id IS NULL OR NOT (
               ROW(report.service_id, report.counter_id, report.status, report.issued_at,
                   report.called_at, report.started_at, report.completed_at, report.closed_at,
                   report.queue_date, report.arrival_hour, report.completion_date,
                   report.wait_seconds, report.handling_seconds, report.estimate_seconds, report.estimate_basis)
               <=>
               ROW(t.service_id, t.counter_id, t.status, t.issued_at,
                   t.called_at, t.started_at, t.completed_at, t.closed_at,
                   DATE(CONVERT_TZ(t.issued_at, '+00:00', '+05:30')),
                   HOUR(CONVERT_TZ(t.issued_at, '+00:00', '+05:30')),
                   DATE(CONVERT_TZ(t.completed_at, '+00:00', '+05:30')),
                   TIMESTAMPDIFF(MICROSECOND, t.issued_at, t.called_at) * 0.000001,
                   TIMESTAMPDIFF(MICROSECOND, t.started_at, t.completed_at) * 0.000001,
                   t.estimate_seconds, t.estimate_basis)
           )
       );

INSERT INTO reporting_checks
WITH expected (service_code, queue_date, issued_tokens, completed_tokens, cancelled_tokens, skipped_tokens,
               no_show_tokens, wait_samples, avg_wait_seconds, p90_wait_seconds, avg_handling_seconds) AS (
    SELECT 'ADM', DATE '2026-01-12', 7, 5, 1, 0, 1, 6, 300.0, 480.0, 342.0
    UNION ALL SELECT 'ADM', DATE '2026-01-13', 6, 4, 1, 1, 0, 5, 156.0, 360.0, 315.0
    UNION ALL SELECT 'ADM', DATE '2026-01-19', 4, 4, 0, 0, 0, 4, 165.0, 282.0, 307.5
    UNION ALL SELECT 'BON', DATE '2026-01-12', 5, 4, 1, 0, 0, 4, 285.0, 420.0, 210.0
    UNION ALL SELECT 'BON', DATE '2026-01-13', 4, 3, 0, 0, 1, 4, 180.0, 300.0, 210.0
    UNION ALL SELECT 'BON', DATE '2026-01-19', 2, 2, 0, 0, 0, 2, 180.0, 276.0, 210.0
), actual AS (
    SELECT s.service_code, d.queue_date, d.issued_tokens, d.completed_tokens, d.cancelled_tokens,
           d.skipped_tokens, d.no_show_tokens, d.wait_samples,
           ROUND(d.avg_wait_seconds, 3), ROUND(d.p90_wait_seconds, 3), ROUND(d.avg_handling_seconds, 3)
    FROM vw_daily_service_summary AS d JOIN vw_services AS s USING (service_id)
)
SELECT 'Demo daily service metrics including interpolated percentiles',
       NOT EXISTS (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
       AND NOT EXISTS (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected);

INSERT INTO reporting_checks
WITH daily_waits AS (
    SELECT service_id, queue_date, wait_samples, avg_wait_seconds, p90_wait_seconds
    FROM vw_daily_service_summary
)
SELECT 'Waiting-time view matches validated daily wait metrics',
       NOT EXISTS (SELECT * FROM daily_waits EXCEPT ALL SELECT * FROM vw_service_wait_times)
       AND NOT EXISTS (SELECT * FROM vw_service_wait_times EXCEPT ALL SELECT * FROM daily_waits);

INSERT INTO reporting_checks
WITH hourly AS (
    SELECT service_id, DATE(CONVERT_TZ(issued_at, '+00:00', '+05:30')) AS queue_date,
           HOUR(CONVERT_TZ(issued_at, '+00:00', '+05:30')) AS arrival_hour, COUNT(*) AS issued_tokens
    FROM tokens
    GROUP BY service_id, queue_date, arrival_hour
), hourly_totals AS (
    SELECT service_id, queue_date, SUM(issued_tokens) AS issued_tokens
    FROM vw_hourly_queue_demand
    GROUP BY service_id, queue_date
), daily_totals AS (
    SELECT service_id, queue_date, issued_tokens
    FROM vw_daily_service_summary
)
SELECT 'Hourly campus demand matches operational tokens and daily totals',
       NOT EXISTS (SELECT * FROM hourly EXCEPT ALL SELECT * FROM vw_hourly_queue_demand)
       AND NOT EXISTS (SELECT * FROM vw_hourly_queue_demand EXCEPT ALL SELECT * FROM hourly)
       AND NOT EXISTS (SELECT * FROM hourly_totals EXCEPT ALL SELECT * FROM daily_totals)
       AND NOT EXISTS (SELECT * FROM daily_totals EXCEPT ALL SELECT * FROM hourly_totals);

INSERT INTO reporting_checks
WITH expected (counter_code, work_date, staffed_seconds, busy_seconds, completed_tokens, handling_seconds) AS (
    SELECT 'ADM1', DATE '2026-01-12', 12000, 1020, 3, 1020
    UNION ALL SELECT 'ADM1', DATE '2026-01-13', 12600, 1290, 4, 1290
    UNION ALL SELECT 'ADM1', DATE '2026-01-19', 7800, 570, 2, 570
    UNION ALL SELECT 'ADM2', DATE '2026-01-12', 7500, 360, 1, 360
    UNION ALL SELECT 'ADM2', DATE '2026-01-13', 7200, 300, 1, 300
    UNION ALL SELECT 'ADM2', DATE '2026-01-19', 4200, 660, 2, 660
    UNION ALL SELECT 'BON1', DATE '2026-01-12', 11100, 840, 4, 840
    UNION ALL SELECT 'BON1', DATE '2026-01-13', 11100, 630, 3, 630
    UNION ALL SELECT 'BON1', DATE '2026-01-19', 7800, 420, 2, 420
), actual AS (
    SELECT c.counter_code, f.work_date, f.staffed_seconds, f.busy_seconds,
           f.completed_tokens, f.handling_seconds
    FROM vw_counter_performance AS f
    LEFT JOIN vw_counters AS c ON c.counter_id = f.counter_id AND c.service_id = f.service_id
)
SELECT 'Counter work-day staffing, handling, and completions match fixture',
       NOT EXISTS (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
       AND NOT EXISTS (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
       AND EXISTS (SELECT 1 FROM vw_counters WHERE counter_code = 'HOS1');

INSERT INTO reporting_checks
SELECT 'Total counter performance reconciles to staffed time and completions',
       SUM(staffed_seconds) = (
           SELECT SUM(TIMESTAMPDIFF(MICROSECOND, opened_at, closed_at)) * 0.000001
           FROM counter_availability
       )
       AND SUM(busy_seconds) = (
           SELECT SUM(TIMESTAMPDIFF(MICROSECOND, started_at, completed_at)) * 0.000001
           FROM tokens WHERE status = 'COMPLETED'
       )
       AND SUM(completed_tokens) = (SELECT COUNT(*) FROM tokens WHERE status = 'COMPLETED')
FROM vw_counter_performance;

COMMIT;

START TRANSACTION;

SET @report_service = (SELECT id FROM services WHERE code = 'HOS');
SET @report_counter = (SELECT id FROM counters WHERE service_id = @report_service AND code = 'HOS1');
SET @report_student = (SELECT id FROM users WHERE login = 'demo.student.01');
SET @report_staff = (SELECT id FROM users WHERE login = 'demo.staff.hos1');
SET @report_token = UUID();

-- Campus-local time is UTC plus 05:30. Staffed spans overlap and straddle local midnight.
INSERT INTO counter_availability (counter_id, opened_at, closed_at)
VALUES (@report_counter, '2026-01-20 18:28:00', '2026-01-20 18:32:00'),
       (@report_counter, '2026-01-20 18:29:00', '2026-01-20 18:31:00');

INSERT INTO queue_sessions (service_id, queue_date, last_sequence)
VALUES (@report_service, DATE '2026-01-20', 1);
SET @report_queue = LAST_INSERT_ID();

INSERT INTO tokens (
    id, student_id, service_id, queue_session_id, sequence, status, counter_id,
    issued_at, called_at, started_at, completed_at, closed_at
)
VALUES (
    @report_token, @report_student, @report_service, @report_queue, 1, 'COMPLETED', @report_counter,
    '2026-01-20 18:23:00', '2026-01-20 18:25:00', '2026-01-20 18:26:00',
    '2026-01-20 18:33:00', '2026-01-20 18:33:00'
);

INSERT INTO token_events (token_id, actor_id, event_at, from_status, to_status)
VALUES (@report_token, @report_student, '2026-01-20 18:23:00', NULL, 'WAITING'),
       (@report_token, @report_staff, '2026-01-20 18:25:00', 'WAITING', 'CALLED'),
       (@report_token, @report_staff, '2026-01-20 18:26:00', 'CALLED', 'IN_SERVICE'),
       (@report_token, @report_staff, '2026-01-20 18:33:00', 'IN_SERVICE', 'COMPLETED');

INSERT INTO reporting_checks
WITH expected (work_date, staffed_seconds, busy_seconds, completed_tokens, handling_seconds) AS (
    SELECT DATE '2026-01-20', 120, 120, 0, 0
    UNION ALL SELECT DATE '2026-01-21', 120, 120, 1, 420
), actual AS (
    SELECT work_date, staffed_seconds, busy_seconds, completed_tokens, handling_seconds
    FROM vw_counter_performance WHERE counter_id = @report_counter
)
SELECT 'Cross-midnight working time clips and merges overlap without double-counting',
       NOT EXISTS (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
       AND NOT EXISTS (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected);

INSERT INTO reporting_checks
SELECT 'Cross-midnight completion remains in the local issuance cohort',
       EXISTS (
           SELECT 1 FROM vw_daily_service_summary WHERE service_id = @report_service
             AND queue_date = DATE '2026-01-20' AND issued_tokens = 1 AND completed_tokens = 1
             AND wait_samples = 1 AND p90_wait_seconds = 120
       );

ROLLBACK;

DROP TEMPORARY TABLE reporting_checks;
SELECT 'QueueWise reporting checks passed for lifecycle, service demand, waiting time and counter performance.' AS result;
