-- Owner decision 2026-11-01: no end-to-end encryption. Circlo becomes a traditional circles-based social app:
-- accounts with a name, username, email and password (hashed with Argon2id, never stored in clear), email verification
-- by code, and posts, replies, messages and media stored as they are, protected in transit by TLS. The server decides
-- who may see what.
--
-- Everything from the encrypted design (OPAQUE records, identity keys, key backups, epochs, friend payloads, MLS state,
-- sealed reports) is dropped: none of it could be read by the server, so nothing can be migrated. Existing test
-- accounts start over. Ciphertext objects left in the bucket are unreferenced after this; empty the bucket once.

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS
    device_links, devices, epochs, friend_payloads, friendships, identity_keys, invites, key_backups, login_throttle,
    media_uploads, mls_group_members, mls_groups, mls_key_packages, mls_messages, mls_welcomes, opaque_login_states,
    post_likes, post_media, post_replies, posts, recovery_challenges, recovery_methods, refresh_tokens, reports,
    security_events, user_blobs, user_blocks, users;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------- accounts ----------

-- `username` and `email` are stored lowercase. A pending account (email not yet verified) holds its username and email
-- only until someone verifies them first; unverified signups are removed after a day.
CREATE TABLE users (
    id                BINARY(16)   NOT NULL PRIMARY KEY,
    name              VARCHAR(50)  NOT NULL,
    username          VARCHAR(30)  NOT NULL,
    email             VARCHAR(254) NOT NULL,
    password_hash     VARCHAR(255) NOT NULL,
    bio               VARCHAR(160) NOT NULL DEFAULT '',
    avatar_key        CHAR(64)     NULL,
    status            ENUM('pending', 'active') NOT NULL,
    email_verified_at DATETIME(6)  NULL,
    created_at        DATETIME(6)  NOT NULL,
    INDEX ix_users_username (username),
    INDEX ix_users_email (email),
    INDEX ix_users_status_created (status, created_at)
);

-- One-time 6-digit codes sent by email: verifying a new account, or resetting a forgotten password. Only a hash of
-- the code is stored; a code allows 5 wrong guesses and lasts 15 minutes, and a new one replaces the old.
CREATE TABLE email_codes (
    user_id    BINARY(16)  NOT NULL,
    purpose    ENUM('verify', 'reset') NOT NULL,
    code_hash  BINARY(32)  NOT NULL,
    attempts   INT         NOT NULL DEFAULT 0,
    expires_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (user_id, purpose),
    INDEX ix_email_codes_expires (expires_at),
    CONSTRAINT fk_email_codes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- A signed-in app or browser. Revoking one ends its sessions and its background checks.
CREATE TABLE devices (
    id               BINARY(16)  NOT NULL PRIMARY KEY,
    user_id          BINARY(16)  NOT NULL,
    created_at       DATETIME(6) NOT NULL,
    revoked_at       DATETIME(6) NULL,
    check_token_hash BINARY(32)  NULL,
    INDEX ix_devices_user (user_id),
    CONSTRAINT uq_devices_check_token UNIQUE (check_token_hash),
    CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Refresh tokens are stored only as SHA-256 hashes, one rotating chain per device. `rotated_at`: replaced by a newer
-- token (presenting it again means it leaked); `revoked_at`: no longer valid (rotated, or signed out).
CREATE TABLE refresh_tokens (
    token_hash BINARY(32)  NOT NULL PRIMARY KEY,
    user_id    BINARY(16)  NOT NULL,
    device_id  BINARY(16)  NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    revoked_at DATETIME(6) NULL,
    rotated_at DATETIME(6) NULL,
    created_at DATETIME(6) NOT NULL,
    INDEX ix_refresh_tokens_user (user_id),
    INDEX ix_refresh_tokens_device (device_id),
    CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_refresh_tokens_device FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
);

-- Login lockout (owner decision 2026-10-30): 3 wrong passwords lock login for 15 minutes, then 1 hour, then 24 hours.
-- Keyed by SHA-256 of the normalized username or email typed, so unknown accounts are throttled like real ones.
CREATE TABLE login_throttle (
    login_key    BINARY(32)  NOT NULL PRIMARY KEY,
    failures     INT         NOT NULL,
    stage        INT         NOT NULL,
    locked_until DATETIME(6) NULL,
    updated_at   DATETIME(6) NOT NULL
);

-- Sign-ins shown on the account's other devices ("New sign-in. Was this you?"): only the kind and time.
CREATE TABLE security_events (
    id         BINARY(16)  NOT NULL PRIMARY KEY,
    user_id    BINARY(16)  NOT NULL,
    kind       VARCHAR(16) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    INDEX ix_security_events_user (user_id, created_at),
    CONSTRAINT fk_security_events_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ---------- friends and circles ----------

CREATE TABLE friendships (
    id         BINARY(16)  NOT NULL PRIMARY KEY,
    user_a     BINARY(16)  NOT NULL,
    user_b     BINARY(16)  NOT NULL,
    status     ENUM('pending', 'accepted') NOT NULL,
    created_at DATETIME(6) NOT NULL,
    CONSTRAINT uq_friendships_pair UNIQUE (user_a, user_b),
    INDEX ix_friendships_b (user_b, status),
    CONSTRAINT fk_friendships_a FOREIGN KEY (user_a) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_friendships_b FOREIGN KEY (user_b) REFERENCES users (id) ON DELETE CASCADE
);

-- Invite links and QR codes: the only way to connect. Only the token's SHA-256 is stored; single use, 7 days.
CREATE TABLE invites (
    token_hash  BINARY(32)  NOT NULL PRIMARY KEY,
    inviter_id  BINARY(16)  NOT NULL,
    expires_at  DATETIME(6) NOT NULL,
    used_at     DATETIME(6) NULL,
    redeemed_by BINARY(16)  NULL,
    INDEX ix_invites_inviter (inviter_id),
    CONSTRAINT fk_invites_inviter FOREIGN KEY (inviter_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_invites_redeemed_by FOREIGN KEY (redeemed_by) REFERENCES users (id) ON DELETE CASCADE
);

-- An owner's circles (up to 8; ids 1–8 per owner). Names and memberships are shown only to the owner.
CREATE TABLE circles (
    owner_id   BINARY(16)       NOT NULL,
    id         TINYINT UNSIGNED NOT NULL,
    name       VARCHAR(40)      NOT NULL,
    created_at DATETIME(6)      NOT NULL,
    PRIMARY KEY (owner_id, id),
    CONSTRAINT fk_circles_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE circle_members (
    owner_id  BINARY(16)       NOT NULL,
    circle_id TINYINT UNSIGNED NOT NULL,
    member_id BINARY(16)       NOT NULL,
    PRIMARY KEY (owner_id, circle_id, member_id),
    INDEX ix_circle_members_member (member_id),
    CONSTRAINT fk_circle_members_circle FOREIGN KEY (owner_id, circle_id) REFERENCES circles (owner_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_circle_members_member FOREIGN KEY (member_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE user_blocks (
    blocker_id BINARY(16)  NOT NULL,
    blocked_id BINARY(16)  NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id),
    INDEX ix_user_blocks_blocked (blocked_id),
    CONSTRAINT fk_user_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_user_blocks_blocked FOREIGN KEY (blocked_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ---------- posts ----------

-- `audience`: only the author ('only_me'), all current friends ('everyone'), or the people who were in the chosen
-- circles when it was posted ('circles', listed in post_audience). Moving someone into a circle later doesn't open
-- earlier posts; unfriending or blocking always removes access.
CREATE TABLE posts (
    id         BINARY(16)   NOT NULL PRIMARY KEY,
    author_id  BINARY(16)   NOT NULL,
    body       VARCHAR(2000) NOT NULL,
    audience   ENUM('only_me', 'everyone', 'circles') NOT NULL,
    created_at DATETIME(6)  NOT NULL,
    INDEX ix_posts_author_created (author_id, created_at),
    INDEX ix_posts_created (created_at),
    CONSTRAINT fk_posts_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE
);

-- The circles a post went to (author-only, for the audience badge).
CREATE TABLE post_circles (
    post_id   BINARY(16)       NOT NULL,
    circle_id TINYINT UNSIGNED NOT NULL,
    PRIMARY KEY (post_id, circle_id),
    CONSTRAINT fk_post_circles_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
);

-- Who a circles post reached: the members of its circles at the time it was posted.
CREATE TABLE post_audience (
    post_id BINARY(16) NOT NULL,
    user_id BINARY(16) NOT NULL,
    PRIMARY KEY (post_id, user_id),
    INDEX ix_post_audience_user (user_id),
    CONSTRAINT fk_post_audience_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
    CONSTRAINT fk_post_audience_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE post_replies (
    id         BINARY(16)   NOT NULL PRIMARY KEY,
    post_id    BINARY(16)   NOT NULL,
    author_id  BINARY(16)   NOT NULL,
    body       VARCHAR(2000) NOT NULL,
    created_at DATETIME(6)  NOT NULL,
    INDEX ix_post_replies_post (post_id, created_at),
    CONSTRAINT fk_post_replies_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
    CONSTRAINT fk_post_replies_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE post_likes (
    post_id    BINARY(16)  NOT NULL,
    liker_id   BINARY(16)  NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (post_id, liker_id),
    INDEX ix_post_likes_liker (liker_id),
    CONSTRAINT fk_post_likes_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
    CONSTRAINT fk_post_likes_liker FOREIGN KEY (liker_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ---------- chats ----------

-- 1:1 and group chats. `name` is optional (groups); members see each other's names from their profiles.
CREATE TABLE chats (
    id         BINARY(16)  NOT NULL PRIMARY KEY,
    name       VARCHAR(50) NULL,
    created_by BINARY(16)  NULL,
    created_at DATETIME(6) NOT NULL,
    CONSTRAINT fk_chats_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE chat_members (
    chat_id   BINARY(16)  NOT NULL,
    user_id   BINARY(16)  NOT NULL,
    joined_at DATETIME(6) NOT NULL,
    -- Last message this member has seen (read state, shared across their devices).
    read_seq  BIGINT      NOT NULL DEFAULT 0,
    PRIMARY KEY (chat_id, user_id),
    INDEX ix_chat_members_user (user_id),
    CONSTRAINT fk_chat_members_chat FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE chat_messages (
    seq        BIGINT        NOT NULL AUTO_INCREMENT PRIMARY KEY,
    id         BINARY(16)    NOT NULL,
    chat_id    BINARY(16)    NOT NULL,
    sender_id  BINARY(16)    NOT NULL,
    body       VARCHAR(4000) NOT NULL,
    created_at DATETIME(6)   NOT NULL,
    CONSTRAINT uq_chat_messages_id UNIQUE (id),
    INDEX ix_chat_messages_chat (chat_id, seq),
    CONSTRAINT fk_chat_messages_chat FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_messages_sender FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ---------- media ----------

-- Every uploaded file (photo, video, thumbnail, poster, avatar), from a presigned PUT locked to its declared size and
-- type. A file is attached once, to one post, chat message or avatar, and only by its uploader. Unattached uploads and
-- files of deleted posts are removed from the bucket by MediaSweeper.
CREATE TABLE media_uploads (
    object_key  CHAR(64)    NOT NULL PRIMARY KEY,
    owner_id    BINARY(16)  NOT NULL,
    size_bytes  BIGINT      NOT NULL,
    mime        VARCHAR(40) NOT NULL,
    created_at  DATETIME(6) NOT NULL,
    post_id     BINARY(16)  NULL,
    message_id  BINARY(16)  NULL,
    is_avatar   BOOLEAN     NOT NULL DEFAULT FALSE,
    INDEX ix_media_uploads_owner (owner_id, created_at),
    INDEX ix_media_uploads_post (post_id),
    INDEX ix_media_uploads_message (message_id),
    CONSTRAINT fk_media_uploads_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

-- A photo or video on a post or chat message, in order. A photo has a thumbnail; a video has a poster frame.
CREATE TABLE attachments (
    id          BINARY(16)   NOT NULL PRIMARY KEY,
    post_id     BINARY(16)   NULL,
    message_id  BINARY(16)   NULL,
    position    TINYINT      NOT NULL,
    type        ENUM('image', 'video') NOT NULL,
    object_key  CHAR(64)     NOT NULL,
    preview_key CHAR(64)     NOT NULL,
    mime        VARCHAR(40)  NOT NULL,
    width       INT          NOT NULL,
    height      INT          NOT NULL,
    duration_ms INT          NOT NULL DEFAULT 0,
    INDEX ix_attachments_post (post_id, position),
    INDEX ix_attachments_message (message_id, position),
    CONSTRAINT fk_attachments_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE,
    CONSTRAINT fk_attachments_message FOREIGN KEY (message_id) REFERENCES chat_messages (id) ON DELETE CASCADE
);

-- ---------- safety ----------

-- Reports keep a copy of what was reported (the text as it was), so deleting it afterwards doesn't erase the evidence.
CREATE TABLE reports (
    id          BINARY(16)    NOT NULL PRIMARY KEY,
    reporter_id BINARY(16)    NULL,
    target_kind ENUM('post', 'user', 'message') NOT NULL,
    target_id   BINARY(16)    NOT NULL,
    target_user BINARY(16)    NULL,
    reason      VARCHAR(32)   NOT NULL,
    note        VARCHAR(1000) NOT NULL DEFAULT '',
    snapshot    TEXT          NOT NULL,
    created_at  DATETIME(6)   NOT NULL,
    INDEX ix_reports_created (created_at),
    CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE SET NULL
);
