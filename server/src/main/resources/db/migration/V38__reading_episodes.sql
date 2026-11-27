-- Feeds (2.0): podcast episodes play in Circlo. The audio file's address (the feed's enclosure; the phone plays it from
-- the podcast's own server, owner decision 2026-11-27), its type and length, and the episode's own artwork.
ALTER TABLE reading_articles ADD COLUMN audio_url VARCHAR(2048) NULL;
ALTER TABLE reading_articles ADD COLUMN audio_type VARCHAR(100) NULL;
ALTER TABLE reading_articles ADD COLUMN duration_seconds INT NULL;
ALTER TABLE reading_articles ADD COLUMN image_url VARCHAR(2048) NULL;

-- Read every feed again in full, so episodes already kept get their audio.
UPDATE reading_sources SET etag = NULL, modified = NULL, next_check_at = NOW(6);
