-- Likes on replies (owner request 2026-11-01). Like a reply's other reactions, they follow the post's audience.
CREATE TABLE reply_likes (
    reply_id   BINARY(16)  NOT NULL,
    liker_id   BINARY(16)  NOT NULL,
    created_at DATETIME(6) NOT NULL,
    PRIMARY KEY (reply_id, liker_id),
    INDEX ix_reply_likes_liker (liker_id),
    CONSTRAINT fk_reply_likes_reply FOREIGN KEY (reply_id) REFERENCES post_replies (id) ON DELETE CASCADE,
    CONSTRAINT fk_reply_likes_liker FOREIGN KEY (liker_id) REFERENCES users (id) ON DELETE CASCADE
);

-- A person's replies, newest first (the profile's Replies tab).
CREATE INDEX ix_post_replies_author ON post_replies (author_id, created_at);

-- Replies can be reported like posts and messages.
ALTER TABLE reports MODIFY target_kind ENUM('post', 'user', 'message', 'reply') NOT NULL;

-- Remote push is back on iPhone (APNs) and Android (FCM) (owner decision 2026-11-01, reverses 2026-10-30), content-free:
-- a push says only "New reply", "New message" or "New friend request" plus random ids for opening the right screen. The
-- device's push token is sealed (AES-GCM, key derived from the server secret) and cleared when the device signs out or
-- is revoked.
ALTER TABLE devices ADD COLUMN push_token_enc VARBINARY(512) NULL;
ALTER TABLE devices ADD COLUMN push_service ENUM('apns', 'apns_sandbox', 'fcm') NULL;
