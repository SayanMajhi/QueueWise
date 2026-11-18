-- Run with the mysql client against a disposable migrated database ending in _test.
DROP PROCEDURE IF EXISTS queuewise_check_constraints;
DELIMITER $$
CREATE PROCEDURE queuewise_check_constraints()
BEGIN
    DECLARE student_a BIGINT;
    DECLARE student_b BIGINT;
    DECLARE staff BIGINT;
    DECLARE service_a BIGINT;
    DECLARE service_b BIGINT;
    DECLARE counter_a BIGINT;
    DECLARE counter_b BIGINT;
    DECLARE session_a BIGINT;
    DECLARE next_day BIGINT;
    DECLARE first_token CHAR(36);
    DECLARE second_token CHAR(36);
    DECLARE rejected BOOLEAN DEFAULT FALSE;
    DECLARE failure_message TEXT;
    DECLARE issued DATETIME(6) DEFAULT '2026-01-12 18:28:00';
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF RIGHT(DATABASE(), 5) <> '_test' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Constraint checks require a disposable database ending in _test';
    END IF;

    START TRANSACTION;

    INSERT INTO users (login, password_hash, role) VALUES ('phase2-test-a', 'fixture-only', 'STUDENT');
    SET student_a = LAST_INSERT_ID();
    INSERT INTO users (login, password_hash, role) VALUES ('phase2-test-b', 'fixture-only', 'STUDENT');
    SET student_b = LAST_INSERT_ID();
    INSERT INTO users (login, password_hash, role) VALUES ('phase2-test-staff', 'fixture-only', 'STAFF');
    SET staff = LAST_INSERT_ID();
    INSERT INTO services (code, name, default_service_seconds) VALUES ('TQA', 'QA service A', 300);
    SET service_a = LAST_INSERT_ID();
    INSERT INTO services (code, name, default_service_seconds) VALUES ('TQB', 'QA service B', 300);
    SET service_b = LAST_INSERT_ID();
    INSERT INTO counters (service_id, code, name, status) VALUES (service_a, 'T01', 'QA counter A', 'OPEN');
    SET counter_a = LAST_INSERT_ID();
    INSERT INTO counters (service_id, code, name) VALUES (service_b, 'T01', 'QA counter B');
    SET counter_b = LAST_INSERT_ID();
    INSERT INTO queue_sessions (service_id, queue_date, last_sequence) VALUES (service_a, '2026-01-12', 2);
    SET session_a = LAST_INSERT_ID();
    INSERT INTO queue_sessions (service_id, queue_date, last_sequence) VALUES (service_a, '2026-01-13', 1);
    SET next_day = LAST_INSERT_ID();

    -- Exercise the database-generated UUID and UTC timestamp defaults.
    INSERT INTO tokens (student_id, service_id, queue_session_id, `sequence`)
    VALUES (student_a, service_a, session_a, 1);
    SELECT id INTO first_token FROM tokens WHERE queue_session_id = session_a AND `sequence` = 1;
    IF first_token IS NULL OR CHAR_LENGTH(first_token) <> 36 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Token UUID default did not generate an ID';
    END IF;
    UPDATE tokens SET issued_at = issued WHERE id = first_token;

    BEGIN
        DECLARE CONTINUE HANDLER FOR 1062 SET rejected = TRUE;
        INSERT INTO tokens (student_id, service_id, queue_session_id, `sequence`, issued_at)
        VALUES (student_a, service_a, next_day, 1, issued + INTERVAL 4 MINUTE);
    END;
    IF NOT rejected THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Duplicate active student token across dates was accepted';
    END IF;

    SET rejected = FALSE;
    BEGIN
        DECLARE CONTINUE HANDLER FOR 1062 SET rejected = TRUE;
        INSERT INTO tokens (student_id, service_id, queue_session_id, `sequence`, issued_at)
        VALUES (student_b, service_a, session_a, 1, issued);
    END;
    IF NOT rejected THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Duplicate daily queue sequence was accepted';
    END IF;

    SET rejected = FALSE;
    BEGIN
        DECLARE CONTINUE HANDLER FOR 1452 SET rejected = TRUE;
        INSERT INTO tokens (student_id, service_id, queue_session_id, `sequence`, issued_at)
        VALUES (student_b, service_b, session_a, 2, issued);
    END;
    IF NOT rejected THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A token was accepted in a different service queue';
    END IF;

    SET second_token = UUID();
    INSERT INTO tokens (id, student_id, service_id, queue_session_id, `sequence`, issued_at)
    VALUES (second_token, student_b, service_a, session_a, 2, issued);
    INSERT INTO token_events (token_id, actor_id, event_at, to_status)
    VALUES (first_token, student_a, issued, 'WAITING'),
           (second_token, student_b, issued, 'WAITING');

    SET rejected = FALSE;
    BEGIN
        DECLARE CONTINUE HANDLER FOR 1452 SET rejected = TRUE;
        UPDATE tokens SET status = 'CALLED', counter_id = counter_b, called_at = issued WHERE id = first_token;
    END;
    IF NOT rejected THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Counter assignment to a different service was accepted';
    END IF;

    SET rejected = FALSE;
    BEGIN
        DECLARE CONTINUE HANDLER FOR 3819 SET rejected = TRUE;
        UPDATE tokens SET status = 'CALLED', counter_id = counter_a WHERE id = first_token;
    END;
    IF NOT rejected THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Called token without call timestamp was accepted';
    END IF;

    SET rejected = FALSE;
    BEGIN
        DECLARE CONTINUE HANDLER FOR 3819 SET rejected = TRUE;
        UPDATE tokens SET status = 'CALLED', counter_id = counter_a, called_at = issued - INTERVAL 1 SECOND
        WHERE id = first_token;
    END;
    IF NOT rejected THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Call timestamp earlier than issuance was accepted';
    END IF;

    SET rejected = FALSE;
    BEGIN
        DECLARE CONTINUE HANDLER FOR 3819 SET rejected = TRUE;
        UPDATE tokens SET estimate_basis = 'HISTORICAL' WHERE id = first_token;
    END;
    IF NOT rejected THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Historical basis without an estimate was accepted';
    END IF;

    UPDATE tokens SET status = 'CALLED', counter_id = counter_a, called_at = issued + INTERVAL 3 MINUTE
    WHERE id = first_token;
    INSERT INTO token_events (token_id, actor_id, event_at, from_status, to_status)
    VALUES (first_token, staff, issued + INTERVAL 3 MINUTE, 'WAITING', 'CALLED');

    SET rejected = FALSE;
    BEGIN
        DECLARE CONTINUE HANDLER FOR 1062 SET rejected = TRUE;
        UPDATE tokens SET status = 'CALLED', counter_id = counter_a, called_at = issued + INTERVAL 3 MINUTE
        WHERE id = second_token;
    END;
    IF NOT rejected THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Two active assignments at the same counter were accepted';
    END IF;

    INSERT INTO counter_availability (counter_id, opened_at) VALUES (counter_a, issued);
    SET rejected = FALSE;
    BEGIN
        DECLARE CONTINUE HANDLER FOR 1062 SET rejected = TRUE;
        INSERT INTO counter_availability (counter_id, opened_at) VALUES (counter_a, issued + INTERVAL 1 MINUTE);
    END;
    IF NOT rejected THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A second open counter availability interval was accepted';
    END IF;

    SAVEPOINT before_event;
    BEGIN
        DECLARE CONTINUE HANDLER FOR 3819
        BEGIN
            GET DIAGNOSTICS CONDITION 1 failure_message = MESSAGE_TEXT;
            ROLLBACK TO SAVEPOINT before_event;
        END;
        UPDATE tokens SET status = 'SKIPPED', closed_at = issued + INTERVAL 4 MINUTE WHERE id = first_token;
        INSERT INTO token_events (token_id, actor_id, event_at, from_status, to_status)
        VALUES (first_token, staff, issued + INTERVAL 4 MINUTE, 'CALLED', 'SKIPPED');
    END;
    RELEASE SAVEPOINT before_event;
    IF failure_message IS NULL OR LOCATE('token_events_skip_reason', failure_message) = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Skip without a reason did not fail its event check';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM tokens WHERE id = first_token AND status = 'CALLED' AND closed_at IS NULL
    ) OR EXISTS (
        SELECT 1 FROM token_events WHERE token_id = first_token AND to_status = 'SKIPPED'
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid event left a partial queue change after rollback';
    END IF;

    ROLLBACK;
END$$
DELIMITER ;

CALL queuewise_check_constraints();
DROP PROCEDURE queuewise_check_constraints;
SELECT 'QueueWise database constraint and rollback checks passed.' AS result;
