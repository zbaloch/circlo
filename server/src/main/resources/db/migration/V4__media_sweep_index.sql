-- Lets MediaSweeper find unattached uploads (abandoned slots and media of deleted posts) without a table scan.
CREATE INDEX ix_media_uploads_unattached ON media_uploads (post_id, created_at);
