-- Circlo core schema (docs/PLAN.md section 3, adjusted per docs/CRYPTO.md section 14).
-- The server stores only ciphertext, public keys and opaque protocol records.
-- No name, email, circle or caption columns, ever. IDs are 16 random bytes (UUIDv7 or random).
-- Timestamps are UTC DATETIME(6).

-- ---------- accounts and auth ----------

CREATE TABLE users (
    id              BINARY(16)    NOT NULL PRIMARY KEY,
    -- HMAC(CIRCLO_HANDLE_KEY, normalized handle): the handle itself is never stored.
    handle_lookup   BINARY(32)    NOT NULL,
    -- OPAQUE registration record; useless without CIRCLO_OPAQUE_SERVER_SETUP (kept outside the DB).
    opaque_record   VARBINARY(512) NULL,
    recovery_pubkey BINARY(32)    NULL,
    discoverable    BOOLEAN       NOT NULL DEFAULT FALSE,
    status          ENUM('pending', 'active') NOT NULL,
    created_at      DATETIME(6)   NOT NULL,
    CONSTRAINT uq_users_handle_lookup UNIQUE (handle_lookup)
);

-- OPAQUE server login state between start and finish. Server-side only, single use, short-lived.
CREATE TABLE opaque_login_states (
    id         BINARY(16)     NOT NULL PRIMARY KEY,
    user_id    BINARY(16)     NULL,
    state      VARBINARY(1024) NOT NULL,
    expires_at DATETIME(6)    NOT NULL,
    INDEX ix_opaque_login_states_expires (expires_at)
);

CREATE TABLE recovery_challenges (
    id         BINARY(16)  NOT NULL PRIMARY KEY,
    user_id    BINARY(16)  NULL,
    nonce      BINARY(32)  NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    INDEX ix_recovery_challenges_expires (expires_at)
);

-- Refresh tokens are stored only as SHA-256 hashes.
CREATE TABLE refresh_tokens (
    token_hash BINARY(32)  NOT NULL PRIMARY KEY,
    user_id    BINARY(16)  NOT NULL,
    scope      ENUM('full', 'recovery') NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    revoked_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL,
    INDEX ix_refresh_tokens_user (user_id),
    CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE key_backups (
    user_id    BINARY(16)  NOT NULL,
    kind       ENUM('password', 'recovery') NOT NULL,
    ciphertext MEDIUMBLOB  NOT NULL,
    version    INT         NOT NULL,
    PRIMARY KEY (user_id, kind),
    CONSTRAINT fk_key_backups_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE identity_keys (
    user_id     BINARY(16) NOT NULL PRIMARY KEY,
    x25519_pub  BINARY(32) NOT NULL,
    ed25519_pub BINARY(32) NOT NULL,
    signature   BINARY(64) NOT NULL,
    version     INT        NOT NULL,
    CONSTRAINT fk_identity_keys_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE devices (
    id             BINARY(16)     NOT NULL PRIMARY KEY,
    user_id        BINARY(16)     NOT NULL,
    device_pubkey  BINARY(32)     NOT NULL,
    device_cert    BINARY(64)     NOT NULL,
    -- Sealed with CIRCLO_PUSH_TOKEN_KEY (kept outside the DB).
    push_token_enc VARBINARY(1024) NULL,
    created_at     DATETIME(6)    NOT NULL,
    revoked_at     DATETIME(6)    NULL,
    INDEX ix_devices_user (user_id),
    CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ---------- social graph (visible to the server, documented in THREAT_MODEL.md) ----------

CREATE TABLE friendships (
    id         BINARY(16)  NOT NULL PRIMARY KEY,
    user_a     BINARY(16)  NOT NULL,
    user_b     BINARY(16)  NOT NULL,
    status     ENUM('pending', 'accepted', 'blocked') NOT NULL,
    created_at DATETIME(6) NOT NULL,
    CONSTRAINT uq_friendships_pair UNIQUE (user_a, user_b),
    CONSTRAINT fk_friendships_a FOREIGN KEY (user_a) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_friendships_b FOREIGN KEY (user_b) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE epochs (
    id         BINARY(16)  NOT NULL PRIMARY KEY,
    owner_id   BINARY(16)  NOT NULL,
    created_at DATETIME(6) NOT NULL,
    active     BOOLEAN     NOT NULL,
    INDEX ix_epochs_owner (owner_id),
    CONSTRAINT fk_epochs_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Wrapped Ck + profile key: identical 160 bytes for every friend, whatever the circle.
CREATE TABLE friend_payloads (
    id              BINARY(16)  NOT NULL PRIMARY KEY,
    from_user       BINARY(16)  NOT NULL,
    to_user         BINARY(16)  NOT NULL,
    epoch_id        BINARY(16)  NOT NULL,
    hpke_ciphertext BINARY(160) NOT NULL,
    created_at      DATETIME(6) NOT NULL,
    CONSTRAINT uq_friend_payloads UNIQUE (from_user, to_user, epoch_id),
    CONSTRAINT fk_friend_payloads_from FOREIGN KEY (from_user) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_friend_payloads_to FOREIGN KEY (to_user) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_friend_payloads_epoch FOREIGN KEY (epoch_id) REFERENCES epochs (id) ON DELETE CASCADE
);

CREATE TABLE user_blobs (
    user_id    BINARY(16) NOT NULL,
    kind       ENUM('address_book', 'settings', 'profile') NOT NULL,
    epoch_id   BINARY(16) NULL,
    ciphertext MEDIUMBLOB NOT NULL,
    version    INT        NOT NULL,
    PRIMARY KEY (user_id, kind),
    CONSTRAINT fk_user_blobs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE invites (
    token_hash BINARY(32)  NOT NULL PRIMARY KEY,
    inviter_id BINARY(16)  NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    used_at    DATETIME(6) NULL,
    CONSTRAINT fk_invites_inviter FOREIGN KEY (inviter_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ---------- posts ----------

CREATE TABLE posts (
    id          BINARY(16)  NOT NULL PRIMARY KEY,
    author_id   BINARY(16)  NOT NULL,
    epoch_id    BINARY(16)  NOT NULL,
    -- Per-post HMAC tag: reveals neither the circle nor which posts share an audience.
    key_ref     BINARY(32)  NOT NULL,
    header_ct   BLOB        NOT NULL,
    created_at  DATETIME(6) NOT NULL,
    size_bucket TINYINT UNSIGNED NOT NULL,
    INDEX ix_posts_author_created (author_id, created_at),
    CONSTRAINT fk_posts_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_posts_epoch FOREIGN KEY (epoch_id) REFERENCES epochs (id)
);

CREATE TABLE post_media (
    id             BINARY(16) NOT NULL PRIMARY KEY,
    post_id        BINARY(16) NOT NULL,
    object_key     CHAR(64)   NOT NULL,
    ct_size_padded BIGINT     NOT NULL,
    chunk_size     INT        NOT NULL,
    kind           ENUM('full', 'thumb', 'poster') NOT NULL,
    CONSTRAINT uq_post_media_object UNIQUE (object_key),
    CONSTRAINT fk_post_media_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
);

CREATE TABLE post_replies (
    id         BINARY(16)  NOT NULL PRIMARY KEY,
    post_id    BINARY(16)  NOT NULL,
    author_id  BINARY(16)  NOT NULL,
    ciphertext BLOB        NOT NULL,
    created_at DATETIME(6) NOT NULL,
    INDEX ix_post_replies_post (post_id, created_at),
    CONSTRAINT fk_post_replies_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
    CONSTRAINT fk_post_replies_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE post_likes (
    post_id    BINARY(16)  NOT NULL,
    liker_id   BINARY(16)  NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (post_id, liker_id),
    CONSTRAINT fk_post_likes_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
    CONSTRAINT fk_post_likes_liker FOREIGN KEY (liker_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ---------- MLS delivery service (opaque relay) ----------

CREATE TABLE mls_key_packages (
    id          BINARY(16) NOT NULL PRIMARY KEY,
    user_id     BINARY(16) NOT NULL,
    device_id   BINARY(16) NOT NULL,
    key_package BLOB       NOT NULL,
    used        BOOLEAN    NOT NULL DEFAULT FALSE,
    INDEX ix_mls_key_packages_device (device_id, used),
    CONSTRAINT fk_mls_key_packages_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_mls_key_packages_device FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
);

-- No names: group names live in the MLS group context.
CREATE TABLE mls_groups (
    id         BINARY(16)  NOT NULL PRIMARY KEY,
    created_at DATETIME(6) NOT NULL
);

CREATE TABLE mls_messages (
    id         BIGINT      NOT NULL AUTO_INCREMENT PRIMARY KEY,
    group_id   BINARY(16)  NOT NULL,
    epoch      BIGINT      NOT NULL,
    ciphertext MEDIUMBLOB  NOT NULL,
    created_at DATETIME(6) NOT NULL,
    INDEX ix_mls_messages_group (group_id, id),
    CONSTRAINT fk_mls_messages_group FOREIGN KEY (group_id) REFERENCES mls_groups (id) ON DELETE CASCADE
);

CREATE TABLE mls_welcomes (
    id                  BINARY(16)  NOT NULL PRIMARY KEY,
    recipient_device_id BINARY(16)  NOT NULL,
    ciphertext          MEDIUMBLOB  NOT NULL,
    created_at          DATETIME(6) NOT NULL,
    CONSTRAINT fk_mls_welcomes_device FOREIGN KEY (recipient_device_id) REFERENCES devices (id) ON DELETE CASCADE
);
