-- Activity is told once a day, calmly, at an hour each person's app chooses (owner decision 2026-11-01). The waiting
-- counts (no ids, names or text) now serve the daily push as well as the daily email, and stay as one row per person:
-- first_at is when something first happened since the last one, sent_at when the last one went out.
RENAME TABLE email_digests TO daily_digests;
ALTER TABLE daily_digests MODIFY first_at DATETIME(6) NULL, ADD COLUMN sent_at DATETIME(6) NULL;

-- The hour (UTC, 0-23) for the daily notification. The app sets it to 6pm on the phone's clock; a setting, not a time
-- zone or a location.
ALTER TABLE users ADD COLUMN digest_hour TINYINT UNSIGNED NOT NULL DEFAULT 18;
