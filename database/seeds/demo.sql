-- Synthetic campus activity for development, integration tests, and Power BI.
-- Set @demo_password_hash to a bcrypt 2a/2b hash of cost 10–14 in this connection.
CREATE TABLE IF NOT EXISTS demo_seed_history (
    seed_name VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    applied_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6))
) ENGINE = InnoDB;

START TRANSACTION;

-- The unique marker serializes concurrent seed runs and rolls back with the demo rows.
INSERT IGNORE INTO demo_seed_history (seed_name) VALUES ('demo-v1');
SET @queuewise_seed_required = ROW_COUNT() = 1;

DROP TEMPORARY TABLE IF EXISTS demo_seed_hash_check;
CREATE TEMPORARY TABLE demo_seed_hash_check (
    valid BOOLEAN NOT NULL,
    CONSTRAINT supply_demo_password_hash CHECK (valid = TRUE)
) ENGINE = InnoDB;
INSERT INTO demo_seed_hash_check VALUES (
    NOT @queuewise_seed_required OR COALESCE(
        REGEXP_LIKE(@demo_password_hash, '^[$]2[ab][$]1[0-4][$][./A-Za-z0-9]{53}$', 'c'), FALSE
    )
);

INSERT INTO users (login, password_hash, role, is_active)
SELECT login, @demo_password_hash, role, TRUE
FROM (VALUES
    ROW('demo.admin', 'ADMIN'),
    ROW('demo.staff.adm1', 'STAFF'), ROW('demo.staff.adm2', 'STAFF'),
    ROW('demo.staff.bon1', 'STAFF'), ROW('demo.staff.hos1', 'STAFF'),
    ROW('demo.student.01', 'STUDENT'), ROW('demo.student.02', 'STUDENT'),
    ROW('demo.student.03', 'STUDENT'), ROW('demo.student.04', 'STUDENT'),
    ROW('demo.student.05', 'STUDENT'), ROW('demo.student.06', 'STUDENT'),
    ROW('demo.student.07', 'STUDENT'), ROW('demo.student.08', 'STUDENT')
) AS account(login, role)
WHERE @queuewise_seed_required;

INSERT INTO services (code, name, accepts_tokens, default_service_seconds)
SELECT code, name, TRUE, duration
FROM (VALUES
    ROW('ADM', 'Document Verification', 360),
    ROW('BON', 'Bonafide Certificates', 240),
    ROW('HOS', 'Hostel Administration', 300)
) AS fixture(code, name, duration)
WHERE @queuewise_seed_required;

INSERT INTO counters (service_id, code, name, status)
SELECT service.id, fixture.code, fixture.name, 'CLOSED'
FROM (VALUES
    ROW('ADM', 'ADM1', 'Verification Desk 1'),
    ROW('ADM', 'ADM2', 'Verification Desk 2'),
    ROW('BON', 'BON1', 'Certificates Desk'),
    ROW('HOS', 'HOS1', 'Hostel Desk')
) AS fixture(service_code, code, name)
JOIN services AS service ON service.code = fixture.service_code
WHERE @queuewise_seed_required;

INSERT INTO staff_assignments (staff_id, counter_id)
SELECT staff.id, counter.id
FROM counters AS counter
JOIN services AS service ON service.id = counter.service_id
    AND service.code = LEFT(counter.code, 3)
JOIN users AS staff ON staff.login = CONCAT('demo.staff.', LOWER(counter.code))
WHERE @queuewise_seed_required
    AND counter.code IN ('ADM1', 'ADM2', 'BON1', 'HOS1');

INSERT INTO counter_availability (counter_id, opened_at, closed_at)
SELECT counter.id,
       CONVERT_TZ(fixture.opened_at, '+05:30', '+00:00'),
       CONVERT_TZ(fixture.closed_at, '+05:30', '+00:00')
FROM (VALUES
    ROW('ADM1', '2026-01-12 08:55:00', '2026-01-12 12:00:00'),
    ROW('ADM2', '2026-01-12 08:55:00', '2026-01-12 11:00:00'),
    ROW('ADM1', '2026-01-12 23:45:00', '2026-01-13 00:30:00'),
    ROW('ADM1', '2026-01-13 09:00:00', '2026-01-13 12:00:00'),
    ROW('ADM2', '2026-01-13 09:00:00', '2026-01-13 11:00:00'),
    ROW('ADM1', '2026-01-19 13:50:00', '2026-01-19 16:00:00'),
    ROW('ADM2', '2026-01-19 13:50:00', '2026-01-19 15:00:00'),
    ROW('BON1', '2026-01-12 09:55:00', '2026-01-12 13:00:00'),
    ROW('BON1', '2026-01-13 09:55:00', '2026-01-13 13:00:00'),
    ROW('BON1', '2026-01-19 13:50:00', '2026-01-19 16:00:00')
) AS fixture(counter_code, opened_at, closed_at)
JOIN counters AS counter ON counter.code = fixture.counter_code
JOIN services AS service ON service.id = counter.service_id
    AND service.code = LEFT(fixture.counter_code, 3)
WHERE @queuewise_seed_required;

DROP TEMPORARY TABLE IF EXISTS demo_token_fixture;
CREATE TEMPORARY TABLE demo_token_fixture (
    service_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    queue_date DATE NOT NULL,
    `sequence` INT NOT NULL,
    student_number CHAR(2) NOT NULL,
    counter_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    issued_time TIME NOT NULL,
    status VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    call_after_seconds INT,
    start_after_seconds INT,
    close_after_seconds INT NOT NULL,
    estimate_seconds INT,
    estimate_basis VARCHAR(11) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY (service_code, queue_date, `sequence`)
) ENGINE = InnoDB;

-- All offsets are seconds after issuance. The late verification shift crosses midnight.
INSERT INTO demo_token_fixture VALUES
    ('ADM', '2026-01-12', 1, '01', 'ADM1', '09:00', 'COMPLETED', 60, 90, 390, 0, 'DEFAULT'),
    ('ADM', '2026-01-12', 2, '02', 'ADM2', '09:01', 'COMPLETED', 120, 180, 540, 0, 'DEFAULT'),
    ('ADM', '2026-01-12', 3, '03', 'ADM1', '09:02', 'COMPLETED', 360, 390, 690, 240, 'DEFAULT'),
    ('ADM', '2026-01-12', 4, '04', NULL,   '09:03', 'CANCELLED', NULL, NULL, 60, 300, 'DEFAULT'),
    ('ADM', '2026-01-12', 5, '05', 'ADM2', '09:04', 'NO_SHOW', 420, NULL, 480, 360, 'DEFAULT'),
    ('ADM', '2026-01-12', 6, '06', 'ADM1', '09:07', 'COMPLETED', 540, 570, 990, 360, 'DEFAULT'),
    ('ADM', '2026-01-12', 7, '07', 'ADM1', '23:57', 'COMPLETED', 300, 330, 660, 0, 'DEFAULT'),
    ('ADM', '2026-01-13', 1, '08', 'ADM1', '00:01', 'COMPLETED', 480, 510, 810, 360, 'DEFAULT'),
    ('ADM', '2026-01-13', 2, '01', 'ADM1', '09:10', 'COMPLETED', 0, 30, 390, 0, 'HISTORICAL'),
    ('ADM', '2026-01-13', 3, '02', 'ADM2', '09:11', 'SKIPPED', 60, NULL, 90, 0, 'HISTORICAL'),
    ('ADM', '2026-01-13', 4, '03', 'ADM2', '09:12', 'COMPLETED', 60, 90, 390, 90, 'HISTORICAL'),
    ('ADM', '2026-01-13', 5, '04', NULL,   '09:13', 'CANCELLED', NULL, NULL, 60, 180, 'HISTORICAL'),
    ('ADM', '2026-01-13', 6, '05', 'ADM1', '09:14', 'COMPLETED', 180, 210, 510, 150, 'HISTORICAL'),
    ('ADM', '2026-01-19', 1, '06', 'ADM1', '14:00', 'COMPLETED', 60, 90, 330, 0, 'HISTORICAL'),
    ('ADM', '2026-01-19', 2, '07', 'ADM2', '14:01', 'COMPLETED', 60, 90, 390, 0, 'HISTORICAL'),
    ('ADM', '2026-01-19', 3, '08', 'ADM1', '14:02', 'COMPLETED', 240, 270, 600, 210, 'HISTORICAL'),
    ('ADM', '2026-01-19', 4, '01', 'ADM2', '14:03', 'COMPLETED', 300, 330, 690, 300, 'HISTORICAL'),
    ('BON', '2026-01-12', 1, '01', 'BON1', '10:00', 'COMPLETED', 60, 90, 270, 0, 'DEFAULT'),
    ('BON', '2026-01-12', 2, '02', 'BON1', '10:01', 'COMPLETED', 240, 270, 510, 240, 'DEFAULT'),
    ('BON', '2026-01-12', 3, '03', 'BON1', '10:03', 'COMPLETED', 420, 450, 660, 360, 'DEFAULT'),
    ('BON', '2026-01-12', 4, '04', NULL,   '10:05', 'CANCELLED', NULL, NULL, 180, 360, 'DEFAULT'),
    ('BON', '2026-01-12', 5, '05', 'BON1', '10:08', 'COMPLETED', 420, 450, 660, 300, 'DEFAULT'),
    ('BON', '2026-01-13', 1, '06', 'BON1', '10:00', 'COMPLETED', 0, 30, 210, 0, 'DEFAULT'),
    ('BON', '2026-01-13', 2, '07', 'BON1', '10:02', 'COMPLETED', 120, 150, 390, 120, 'DEFAULT'),
    ('BON', '2026-01-13', 3, '08', 'BON1', '10:04', 'NO_SHOW', 300, NULL, 360, 270, 'HISTORICAL'),
    ('BON', '2026-01-13', 4, '01', 'BON1', '10:06', 'COMPLETED', 300, 330, 540, 300, 'HISTORICAL'),
    ('BON', '2026-01-19', 1, '03', 'BON1', '14:00', 'COMPLETED', 60, 90, 330, 0, 'HISTORICAL'),
    ('BON', '2026-01-19', 2, '04', 'BON1', '14:01', 'COMPLETED', 300, 330, 510, 210, 'HISTORICAL');

INSERT INTO queue_sessions (service_id, queue_date, last_sequence)
SELECT service.id, fixture.queue_date, MAX(fixture.`sequence`)
FROM demo_token_fixture AS fixture
JOIN services AS service ON service.code = fixture.service_code
WHERE @queuewise_seed_required
GROUP BY service.id, fixture.queue_date;

INSERT INTO tokens (
    student_id, service_id, queue_session_id, `sequence`, status, counter_id,
    issued_at, called_at, started_at, completed_at, closed_at, estimate_seconds, estimate_basis
)
WITH fixture_times AS (
    SELECT fixture.*,
           CONVERT_TZ(TIMESTAMP(queue_date, issued_time), '+05:30', '+00:00') AS issued_at
    FROM demo_token_fixture AS fixture
)
SELECT student.id, service.id, queue_day.id, fixture.`sequence`, fixture.status, counter.id,
       fixture.issued_at,
       DATE_ADD(fixture.issued_at, INTERVAL fixture.call_after_seconds SECOND),
       DATE_ADD(fixture.issued_at, INTERVAL fixture.start_after_seconds SECOND),
       CASE WHEN fixture.status = 'COMPLETED'
            THEN DATE_ADD(fixture.issued_at, INTERVAL fixture.close_after_seconds SECOND) END,
       DATE_ADD(fixture.issued_at, INTERVAL fixture.close_after_seconds SECOND),
       fixture.estimate_seconds, fixture.estimate_basis
FROM fixture_times AS fixture
JOIN users AS student ON student.login = CONCAT('demo.student.', fixture.student_number)
JOIN services AS service ON service.code = fixture.service_code
JOIN queue_sessions AS queue_day ON queue_day.service_id = service.id
    AND queue_day.queue_date = fixture.queue_date
LEFT JOIN counters AS counter ON counter.service_id = service.id
    AND counter.code = fixture.counter_code
WHERE @queuewise_seed_required;

INSERT INTO token_events (token_id, actor_id, event_at, from_status, to_status, reason)
WITH events AS (
    SELECT token.id AS token_id, stage.event_order,
           CASE WHEN stage.event_order = 1 OR (stage.event_order = 4 AND token.status = 'CANCELLED')
                THEN token.student_id ELSE staff.id END AS actor_id,
           CASE stage.event_order WHEN 1 THEN token.issued_at WHEN 2 THEN token.called_at
                WHEN 3 THEN token.started_at ELSE token.closed_at END AS event_at,
           CASE stage.event_order
                WHEN 2 THEN 'WAITING'
                WHEN 3 THEN 'CALLED'
                WHEN 4 THEN CASE token.status WHEN 'CANCELLED' THEN 'WAITING'
                     WHEN 'COMPLETED' THEN 'IN_SERVICE' ELSE 'CALLED' END END AS from_status,
           CASE stage.event_order WHEN 1 THEN 'WAITING' WHEN 2 THEN 'CALLED'
                WHEN 3 THEN 'IN_SERVICE' ELSE token.status END AS to_status,
           CASE WHEN stage.event_order = 4 AND token.status = 'SKIPPED'
                THEN 'Missing required documents' END AS reason
    FROM demo_token_fixture AS fixture
    JOIN services AS service ON service.code = fixture.service_code
    JOIN queue_sessions AS queue_day ON queue_day.service_id = service.id
        AND queue_day.queue_date = fixture.queue_date
    JOIN tokens AS token ON token.queue_session_id = queue_day.id
        AND token.`sequence` = fixture.`sequence`
    LEFT JOIN users AS staff ON staff.login = CONCAT('demo.staff.', LOWER(fixture.counter_code))
    CROSS JOIN (VALUES ROW(1), ROW(2), ROW(3), ROW(4)) AS stage(event_order)
    WHERE @queuewise_seed_required
)
SELECT token_id, actor_id, event_at, from_status, to_status, reason
FROM events WHERE event_at IS NOT NULL
ORDER BY token_id, event_order;

DROP TEMPORARY TABLE demo_token_fixture, demo_seed_hash_check;
COMMIT;
