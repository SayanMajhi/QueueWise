CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY
        CHECK (REGEXP_LIKE(token_hash, '^[0-9a-f]{64}$', 'c')),
    user_id BIGINT NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    INDEX auth_sessions_user_idx (user_id),
    INDEX auth_sessions_expiry_idx (expires_at)
) ENGINE = InnoDB;
