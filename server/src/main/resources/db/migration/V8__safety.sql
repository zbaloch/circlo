-- Phase 11: read tokens, blocks, reports.

-- H(read_token) (CRYPTO.md 13c): replies, likes and their counts need the token, which only the post's audience can
-- derive. NULL only for posts created before this migration (friend check only).
ALTER TABLE posts ADD COLUMN read_token_hash BINARY(32) NULL;

CREATE TABLE user_blocks (
    blocker_id BINARY(16)  NOT NULL,
    blocked_id BINARY(16)  NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id),
    INDEX ix_user_blocks_blocked (blocked_id),
    CONSTRAINT fk_user_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_user_blocks_blocked FOREIGN KEY (blocked_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Sealed to the operator's moderation key on the reporter's phone; the server can't read them.
CREATE TABLE reports (
    id          BINARY(16)  NOT NULL PRIMARY KEY,
    reporter_id BINARY(16)  NULL,
    sealed      MEDIUMBLOB  NOT NULL,
    created_at  DATETIME(6) NOT NULL,
    CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE SET NULL
);
