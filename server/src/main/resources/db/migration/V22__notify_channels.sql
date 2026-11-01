-- Where to tell people about replies, messages and requests (owner decision 2026-11-01): on their phones when they have
-- the app, by email when they don't. A sign-in records only which kind of app it is (no model, OS version or browser).
-- NULL: signed in before this was asked; treated like a browser until the app reports itself.
ALTER TABLE devices ADD COLUMN kind ENUM('ios', 'android', 'web') NULL;
UPDATE devices SET kind = 'ios' WHERE push_service IN ('apns', 'apns_sandbox');
UPDATE devices SET kind = 'android' WHERE push_service = 'fcm';

-- Apple or Google said this device's push token is dead (usually: the app was deleted). It no longer counts as an app
-- until it registers a token again.
ALTER TABLE devices ADD COLUMN push_lost BOOLEAN NOT NULL DEFAULT FALSE;

-- Notification emails can be turned off (Settings, or the unsubscribe link in every one).
ALTER TABLE users ADD COLUMN email_notifications BOOLEAN NOT NULL DEFAULT TRUE;

-- Waiting notification emails, one row per person: counts only (no ids, names or text), sent as one email a short
-- while after the first, then deleted.
CREATE TABLE email_digests (
    user_id  BINARY(16)  NOT NULL PRIMARY KEY,
    replies  INT         NOT NULL DEFAULT 0,
    messages INT         NOT NULL DEFAULT 0,
    requests INT         NOT NULL DEFAULT 0,
    first_at DATETIME(6) NOT NULL,
    INDEX ix_email_digests_first (first_at),
    CONSTRAINT fk_email_digests_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
