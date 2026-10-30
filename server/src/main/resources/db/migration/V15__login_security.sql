-- Password login lockout (owner decision 2026-10-30): after 3 failed attempts password login is locked for 15 minutes,
-- then 1 hour, then 24 hours; the recovery phrase always works. Keyed by the handle lookup (never the handle), and
-- unknown handles are throttled exactly like real ones so the lock reveals nothing about which accounts exist.
CREATE TABLE login_throttle (
    handle_lookup BINARY(32)  NOT NULL PRIMARY KEY,
    failures      INT         NOT NULL,
    stage         INT         NOT NULL,
    locked_until  DATETIME(6) NULL,
    updated_at    DATETIME(6) NOT NULL
);

-- Sign-ins shown to the user's other devices ("New sign-in to your account. Was this you?"). Only the kind and time:
-- no device names, addresses or locations.
CREATE TABLE security_events (
    id         BINARY(16)  NOT NULL PRIMARY KEY,
    user_id    BINARY(16)  NOT NULL,
    kind       VARCHAR(16) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    INDEX idx_security_events_user (user_id, created_at),
    CONSTRAINT fk_security_events_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
