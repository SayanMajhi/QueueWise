CREATE OR REPLACE VIEW vw_services AS
SELECT id AS service_id, code AS service_code, name AS service_name
FROM services;

CREATE OR REPLACE VIEW vw_counters AS
SELECT id AS counter_id, service_id, code AS counter_code, name AS counter_name
FROM counters;

CREATE OR REPLACE VIEW vw_token_lifecycle AS
SELECT id AS token_id, service_id, counter_id,
       DATE(issued_at + INTERVAL 330 MINUTE) AS queue_date,
       HOUR(issued_at + INTERVAL 330 MINUTE) AS arrival_hour,
       issued_at, called_at, started_at, completed_at, closed_at,
       DATE(completed_at + INTERVAL 330 MINUTE) AS completion_date,
       status,
       TIMESTAMPDIFF(MICROSECOND, issued_at, called_at) * 0.000001 AS wait_seconds,
       TIMESTAMPDIFF(MICROSECOND, started_at, completed_at) * 0.000001 AS handling_seconds,
       estimate_seconds, estimate_basis
FROM tokens;

CREATE OR REPLACE VIEW vw_daily_service_summary AS
WITH ranked_waits AS (
    SELECT service_id, queue_date, wait_seconds,
           ROW_NUMBER() OVER (PARTITION BY service_id, queue_date ORDER BY wait_seconds) AS sample_number,
           1 + 0.9 * (COUNT(*) OVER (PARTITION BY service_id, queue_date) - 1) AS p90_position
    FROM vw_token_lifecycle
    WHERE wait_seconds IS NOT NULL
), percentiles AS (
    SELECT service_id, queue_date,
           SUM(wait_seconds * (1 - ABS(sample_number - p90_position))) AS p90_wait_seconds
    FROM ranked_waits
    WHERE sample_number BETWEEN FLOOR(p90_position) AND CEIL(p90_position)
    GROUP BY service_id, queue_date
), daily AS (
    SELECT service_id, queue_date,
           COUNT(*) AS issued_tokens,
           COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) AS completed_tokens,
           COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) AS cancelled_tokens,
           COUNT(CASE WHEN status = 'SKIPPED' THEN 1 END) AS skipped_tokens,
           COUNT(CASE WHEN status = 'NO_SHOW' THEN 1 END) AS no_show_tokens,
           COUNT(wait_seconds) AS wait_samples,
           AVG(wait_seconds) AS avg_wait_seconds,
           AVG(handling_seconds) AS avg_handling_seconds
    FROM vw_token_lifecycle
    GROUP BY service_id, queue_date
)
SELECT d.service_id, d.queue_date, d.issued_tokens, d.completed_tokens, d.cancelled_tokens,
       d.skipped_tokens, d.no_show_tokens, d.wait_samples, d.avg_wait_seconds,
       p.p90_wait_seconds, d.avg_handling_seconds
FROM daily AS d
LEFT JOIN percentiles AS p USING (service_id, queue_date);

CREATE OR REPLACE VIEW vw_service_wait_times AS
SELECT service_id, queue_date, wait_samples, avg_wait_seconds, p90_wait_seconds
FROM vw_daily_service_summary;

CREATE OR REPLACE VIEW vw_hourly_queue_demand AS
SELECT service_id, queue_date, arrival_hour, COUNT(*) AS issued_tokens
FROM vw_token_lifecycle
GROUP BY service_id, queue_date, arrival_hour;

CREATE OR REPLACE VIEW vw_counter_performance AS
WITH RECURSIVE staffed_spans AS (
    SELECT counter_id, opened_at AS start_at,
           LEAST(COALESCE(closed_at, UTC_TIMESTAMP(6)), UTC_TIMESTAMP(6)) AS end_at
    FROM counter_availability
), busy_spans AS (
    SELECT counter_id, started_at AS start_at,
           LEAST(COALESCE(completed_at, UTC_TIMESTAMP(6)), UTC_TIMESTAMP(6)) AS end_at
    FROM tokens
    WHERE status IN ('IN_SERVICE', 'COMPLETED')
), all_edges AS (
    -- The counters track staffed and busy overlap independently.
    SELECT counter_id, start_at AS edge_at, 1 AS staffed_delta, 0 AS busy_delta
    FROM staffed_spans WHERE start_at < end_at
    UNION ALL
    SELECT counter_id, end_at, -1, 0 FROM staffed_spans WHERE start_at < end_at
    UNION ALL
    SELECT counter_id, start_at, 0, 1 FROM busy_spans WHERE start_at < end_at
    UNION ALL
    SELECT counter_id, end_at, 0, -1 FROM busy_spans WHERE start_at < end_at
), unique_edges AS (
    SELECT counter_id, edge_at, SUM(staffed_delta) AS staffed_delta, SUM(busy_delta) AS busy_delta
    FROM all_edges
    GROUP BY counter_id, edge_at
), timeline AS (
    SELECT counter_id, edge_at AS start_at,
           LEAD(edge_at) OVER (PARTITION BY counter_id ORDER BY edge_at) AS end_at,
           SUM(staffed_delta) OVER (PARTITION BY counter_id ORDER BY edge_at) AS staffed_depth,
           SUM(busy_delta) OVER (PARTITION BY counter_id ORDER BY edge_at) AS busy_depth
    FROM unique_edges
), segments AS (
    SELECT counter_id, start_at, end_at, busy_depth > 0 AS is_busy,
           DATE(start_at + INTERVAL 330 MINUTE) AS first_day,
           DATEDIFF(end_at + INTERVAL 330 MINUTE - INTERVAL 1 MICROSECOND,
                    start_at + INTERVAL 330 MINUTE) + 1 AS day_count
    FROM timeline
    WHERE staffed_depth > 0 AND start_at < end_at
), segment_days AS (
    -- Binary expansion enumerates each day once with logarithmic recursion depth.
    SELECT counter_id, start_at, end_at, is_busy, first_day, day_count, 1 AS day_index
    FROM segments
    UNION ALL
    SELECT d.counter_id, d.start_at, d.end_at, d.is_busy, d.first_day, d.day_count,
           2 * d.day_index + v.digit
    FROM segment_days AS d
    CROSS JOIN (SELECT 0 AS digit UNION ALL SELECT 1) AS v
    WHERE 2 * d.day_index + v.digit <= d.day_count
), work_days AS (
    SELECT counter_id, start_at, end_at, is_busy,
           first_day + INTERVAL (day_index - 1) DAY AS work_date
    FROM segment_days
), slices AS (
    SELECT counter_id, work_date, is_busy,
           TIMESTAMPDIFF(MICROSECOND,
               GREATEST(start_at, CAST(work_date AS DATETIME) - INTERVAL 330 MINUTE),
               LEAST(end_at, CAST(work_date AS DATETIME) + INTERVAL 1 DAY - INTERVAL 330 MINUTE)
           ) * 0.000001 AS seconds
    FROM work_days
), daily_staffing AS (
    SELECT counter_id, work_date, SUM(seconds) AS staffed_seconds,
           SUM(CASE WHEN is_busy THEN seconds ELSE 0 END) AS busy_seconds
    FROM slices
    GROUP BY counter_id, work_date
), daily_completions AS (
    SELECT counter_id, completion_date AS work_date,
           COUNT(*) AS completed_tokens, SUM(handling_seconds) AS handling_seconds
    FROM vw_token_lifecycle
    WHERE status = 'COMPLETED'
    GROUP BY counter_id, completion_date
), fact_days AS (
    SELECT counter_id, work_date FROM daily_staffing
    UNION
    SELECT counter_id, work_date FROM daily_completions
)
SELECT f.counter_id, c.service_id, f.work_date,
       COALESCE(s.staffed_seconds, 0) AS staffed_seconds,
       COALESCE(s.busy_seconds, 0) AS busy_seconds,
       COALESCE(p.completed_tokens, 0) AS completed_tokens,
       COALESCE(p.handling_seconds, 0) AS handling_seconds
FROM fact_days AS f
JOIN counters AS c ON c.id = f.counter_id
LEFT JOIN daily_staffing AS s USING (counter_id, work_date)
LEFT JOIN daily_completions AS p USING (counter_id, work_date);
