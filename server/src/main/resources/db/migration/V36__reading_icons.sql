-- Feeds (2.0): each source's logo for its tile (SourceIcons): the feed's own image, else its site's icon. Phones get it
-- through Circlo's image proxy, so sites never see who follows them. icon_checked_at: when Circlo last looked (weekly).
ALTER TABLE reading_sources ADD COLUMN icon_url VARCHAR(2048) NULL;
ALTER TABLE reading_sources ADD COLUMN icon_checked_at DATETIME(6) NULL;

-- Read every feed again in full straight away, so sources get their logos now rather than when their feed next changes.
UPDATE reading_sources SET etag = NULL, modified = NULL, next_check_at = NOW(6);
