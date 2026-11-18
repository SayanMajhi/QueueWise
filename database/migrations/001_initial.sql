CREATE TABLE IF NOT EXISTS users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    login VARCHAR(128) COLLATE utf8mb4_0900_bin NOT NULL UNIQUE CHECK (TRIM(login) <> ''),
    password_hash VARCHAR(255) NOT NULL CHECK (TRIM(password_hash) <> ''),
    role VARCHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL CHECK (role IN ('STUDENT', 'STAFF', 'ADMIN')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE CHECK (is_active IN (FALSE, TRUE))
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS services (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE
        CHECK (REGEXP_LIKE(code, '^[A-Z0-9][A-Z0-9_-]*$', 'c')),
    name VARCHAR(120) NOT NULL CHECK (TRIM(name) <> ''),
    accepts_tokens BOOLEAN NOT NULL DEFAULT TRUE CHECK (accepts_tokens IN (FALSE, TRUE)),
    default_service_seconds INT NOT NULL CHECK (default_service_seconds > 0)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS counters (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    service_id BIGINT NOT NULL,
    code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
        CHECK (REGEXP_LIKE(code, '^[A-Z0-9][A-Z0-9_-]*$', 'c')),
    name VARCHAR(120) NOT NULL CHECK (TRIM(name) <> ''),
    status VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CLOSED'
        CHECK (status IN ('OPEN', 'DRAINING', 'CLOSED')),
    UNIQUE (service_id, code),
    UNIQUE (id, service_id),
    FOREIGN KEY (service_id) REFERENCES services (id)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS staff_assignments (
    staff_id BIGINT PRIMARY KEY,
    counter_id BIGINT NOT NULL,
    FOREIGN KEY (staff_id) REFERENCES users (id),
    FOREIGN KEY (counter_id) REFERENCES counters (id),
    INDEX staff_assignments_counter_idx (counter_id)
) ENGINE = InnoDB;

-- Retained independently of the assignment so changes for one staff member share a stable lock.
CREATE TABLE IF NOT EXISTS staff_assignment_guards (
    staff_id BIGINT PRIMARY KEY,
    FOREIGN KEY (staff_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS queue_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    service_id BIGINT NOT NULL,
    queue_date DATE NOT NULL,
    last_sequence INT NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
    UNIQUE (service_id, queue_date),
    UNIQUE (id, service_id),
    FOREIGN KEY (service_id) REFERENCES services (id)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS tokens (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT (UUID()) PRIMARY KEY,
    student_id BIGINT NOT NULL,
    service_id BIGINT NOT NULL,
    queue_session_id BIGINT NOT NULL,
    `sequence` INT NOT NULL CHECK (`sequence` > 0),
    status VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'WAITING'
        CHECK (status IN ('WAITING', 'CALLED', 'IN_SERVICE', 'COMPLETED', 'CANCELLED', 'SKIPPED', 'NO_SHOW')),
    counter_id BIGINT,
    issued_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    called_at DATETIME(6),
    started_at DATETIME(6),
    completed_at DATETIME(6),
    closed_at DATETIME(6),
    estimate_seconds INT,
    estimate_basis VARCHAR(11) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'UNAVAILABLE'
        CHECK (estimate_basis IN ('HISTORICAL', 'DEFAULT', 'UNAVAILABLE')),
    active_student_id BIGINT GENERATED ALWAYS AS (
        CASE WHEN status IN ('WAITING', 'CALLED', 'IN_SERVICE') THEN student_id END
    ) VIRTUAL,
    active_counter_id BIGINT GENERATED ALWAYS AS (
        CASE WHEN status IN ('CALLED', 'IN_SERVICE') THEN counter_id END
    ) VIRTUAL,
    UNIQUE (queue_session_id, `sequence`),
    UNIQUE KEY tokens_active_student_service_uidx (active_student_id, service_id),
    UNIQUE KEY tokens_active_counter_uidx (active_counter_id),
    FOREIGN KEY (student_id) REFERENCES users (id),
    FOREIGN KEY (queue_session_id, service_id) REFERENCES queue_sessions (id, service_id),
    FOREIGN KEY (counter_id, service_id) REFERENCES counters (id, service_id),
    INDEX tokens_waiting_fifo_idx (service_id, status, queue_session_id, `sequence`),
    INDEX tokens_service_recent_completions_idx (service_id, status, completed_at DESC),
    INDEX tokens_student_idx (student_id),
    INDEX tokens_counter_idx (counter_id, service_id),
    CONSTRAINT tokens_status_timestamps CHECK (
        (counter_id IS NOT NULL) = (status IN ('CALLED', 'IN_SERVICE', 'COMPLETED', 'SKIPPED', 'NO_SHOW'))
        AND (called_at IS NOT NULL) = (counter_id IS NOT NULL)
        AND (started_at IS NOT NULL) = (status IN ('IN_SERVICE', 'COMPLETED'))
        AND (completed_at IS NOT NULL) = (status = 'COMPLETED')
        AND (closed_at IS NOT NULL) = (status IN ('COMPLETED', 'CANCELLED', 'SKIPPED', 'NO_SHOW'))
    ),
    CONSTRAINT tokens_timestamp_order CHECK (
        (called_at IS NULL OR called_at >= issued_at)
        AND (started_at IS NULL OR started_at >= called_at)
        AND (closed_at IS NULL OR closed_at >= COALESCE(called_at, issued_at))
        AND (completed_at IS NULL OR (completed_at >= started_at AND completed_at = closed_at))
    ),
    CONSTRAINT tokens_estimate_shape CHECK (
        (estimate_basis = 'UNAVAILABLE' AND estimate_seconds IS NULL)
        OR (estimate_basis IN ('HISTORICAL', 'DEFAULT') AND estimate_seconds IS NOT NULL AND estimate_seconds >= 0)
    )
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS token_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    token_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    actor_id BIGINT NOT NULL,
    event_at DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    from_status VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin,
    to_status VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reason VARCHAR(500),
    UNIQUE (token_id, to_status),
    FOREIGN KEY (token_id) REFERENCES tokens (id),
    FOREIGN KEY (actor_id) REFERENCES users (id),
    INDEX token_events_actor_idx (actor_id),
    CONSTRAINT token_events_transition CHECK (
        (CASE from_status
            WHEN 'WAITING' THEN to_status IN ('CALLED', 'CANCELLED')
            WHEN 'CALLED' THEN to_status IN ('IN_SERVICE', 'SKIPPED', 'NO_SHOW')
            WHEN 'IN_SERVICE' THEN to_status = 'COMPLETED'
            ELSE from_status IS NULL AND to_status = 'WAITING'
        END) = TRUE
    ),
    CONSTRAINT token_events_skip_reason CHECK (
        to_status <> 'SKIPPED' OR (reason IS NOT NULL AND TRIM(reason) <> '')
    )
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE IF NOT EXISTS counter_availability (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    counter_id BIGINT NOT NULL,
    opened_at DATETIME(6) NOT NULL,
    closed_at DATETIME(6),
    open_counter_id BIGINT GENERATED ALWAYS AS (
        CASE WHEN closed_at IS NULL THEN counter_id END
    ) VIRTUAL,
    FOREIGN KEY (counter_id) REFERENCES counters (id),
    UNIQUE KEY counter_availability_open_interval_uidx (open_counter_id),
    INDEX counter_availability_counter_opened_idx (counter_id, opened_at),
    CHECK (closed_at IS NULL OR closed_at > opened_at)
) ENGINE = InnoDB;
