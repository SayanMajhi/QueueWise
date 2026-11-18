-- Run with the mysql client against the migrated database containing only the demo seed.
DROP PROCEDURE IF EXISTS queuewise_check_demo;
DELIMITER $$
CREATE PROCEDURE queuewise_check_demo()
BEGIN
    DECLARE issued_count BIGINT;
    DECLARE completed_count BIGINT;
    DECLARE mean_wait DECIMAL(12, 3);
    DECLARE p90_wait DECIMAL(12, 3);
    DECLARE mean_handling DECIMAL(12, 3);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    START TRANSACTION READ ONLY;

    SELECT COUNT(*), SUM(status = 'COMPLETED'),
           ROUND(AVG(TIMESTAMPDIFF(MICROSECOND, issued_at, called_at) / 1000000), 3),
           ROUND(AVG(TIMESTAMPDIFF(MICROSECOND, started_at, completed_at) / 1000000), 3)
    INTO issued_count, completed_count, mean_wait, mean_handling
    FROM tokens;

    -- Inclusive continuous percentile with interpolation between the adjacent ranks.
    WITH ranked AS (
        SELECT TIMESTAMPDIFF(MICROSECOND, issued_at, called_at) / 1000000 AS wait_seconds,
               ROW_NUMBER() OVER (ORDER BY TIMESTAMPDIFF(MICROSECOND, issued_at, called_at)) AS row_num,
               1 + (COUNT(*) OVER () - 1) * 0.9 AS p90_rank
        FROM tokens
        WHERE called_at IS NOT NULL
    )
    SELECT ROUND(SUM(CASE
        WHEN row_num = FLOOR(p90_rank) THEN wait_seconds * (1 - (p90_rank - FLOOR(p90_rank)))
        WHEN row_num = CEIL(p90_rank) THEN wait_seconds * (p90_rank - FLOOR(p90_rank))
    END), 3)
    INTO p90_wait
    FROM ranked;

    IF NOT (issued_count <=> 28 AND completed_count <=> 22 AND mean_wait <=> 218.400
        AND p90_wait <=> 420.000 AND mean_handling <=> 276.818) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Expected demo totals 28 issued, 22 completed, wait 218.400s, P90 420s, handling 276.818s';
    END IF;

    IF (SELECT COUNT(*) FROM services) <> 3
        OR (SELECT COUNT(*) FROM counters) <> 4
        OR (SELECT COUNT(*) FROM token_events) <> 103
        OR (SELECT COUNT(*) FROM counter_availability) <> 10 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unexpected demo service, counter, event or staffing counts';
    END IF;

    IF (SELECT COUNT(*) FROM tokens
        WHERE DATE(CONVERT_TZ(called_at, '+00:00', '+05:30'))
            > DATE(CONVERT_TZ(issued_at, '+00:00', '+05:30'))) <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Expected one wait spanning campus-local midnight';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM queue_sessions AS queue_day
        JOIN tokens AS token ON token.queue_session_id = queue_day.id
        GROUP BY queue_day.id, queue_day.last_sequence
        HAVING MIN(token.`sequence`) <> 1
            OR MAX(token.`sequence`) <> queue_day.last_sequence
            OR COUNT(*) <> queue_day.last_sequence
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Demo numbering is not contiguous within each daily session';
    END IF;

    IF EXISTS (
        SELECT 1 FROM tokens AS a
        JOIN tokens AS b ON a.counter_id = b.counter_id AND a.id < b.id
        WHERE a.called_at < b.closed_at AND b.called_at < a.closed_at
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Synthetic counter assignments overlap';
    END IF;

    COMMIT;
END$$
DELIMITER ;

CALL queuewise_check_demo();
DROP PROCEDURE queuewise_check_demo;
SELECT 'QueueWise demo metrics, numbering, and staffing checks passed.' AS result;
