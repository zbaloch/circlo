-- No remote push (owner decision 2026-10-30): Apple and Google no longer learn when anyone gets activity. Push tokens
-- go, and a phone that opts in to background checks gets a check token instead (stored only as its SHA-256), which can
-- read nothing but counts of new activity (GET /v1/activity/pending).
ALTER TABLE devices DROP COLUMN push_token_enc;
ALTER TABLE devices DROP COLUMN push_platform;
ALTER TABLE devices ADD COLUMN check_token_hash BINARY(32) NULL;
CREATE UNIQUE INDEX uq_devices_check_token ON devices (check_token_hash);
