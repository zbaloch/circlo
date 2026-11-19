-- Notification settings per kind (owner decision 2026-11-18): whether messages, replies, and friend requests and new
-- friends push at once, and whether the 6pm reminder pushes. Settings of the account (they apply to all my phones),
-- on until I turn them off. Security alerts don't look at them.
ALTER TABLE users
    ADD COLUMN push_messages BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN push_replies  BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN push_friends  BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN push_daily    BOOLEAN NOT NULL DEFAULT TRUE;

-- New posts I can see count towards the reminder too (a count until the next one, never sent).
ALTER TABLE daily_digests ADD COLUMN posts INT NOT NULL DEFAULT 0;
