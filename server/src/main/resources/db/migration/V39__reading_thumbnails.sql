-- Feeds (2.0): items' own pictures now include Media RSS thumbnails (a YouTube video's, a news story's), kept in
-- reading_articles.image_url like a podcast episode's artwork. Read every feed again in full so they arrive now.
UPDATE reading_sources SET etag = NULL, modified = NULL, next_check_at = NOW(6);
