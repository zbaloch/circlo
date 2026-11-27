-- Feeds (2.0): everything a feed carries is now kept (a blog that last posted months ago used to look empty); articles
-- older than 60 days go only beyond each source's newest 100. Read every feed again in full, so what was skipped arrives.
UPDATE reading_sources SET etag = NULL, modified = NULL, next_check_at = NOW(6);
