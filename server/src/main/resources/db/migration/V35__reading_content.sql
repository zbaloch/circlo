-- Feeds (2.0): an article's full text as the feed carries it (content:encoded, Atom content, else the description),
-- kept as simple blocks the app draws itself (FeedContent), so it can be read in Circlo with a link to the site.
-- has_content: whether there's clearly more than the summary, or pictures; otherwise tapping opens the site.
ALTER TABLE reading_articles ADD COLUMN content MEDIUMTEXT NULL;
ALTER TABLE reading_articles ADD COLUMN has_content BOOLEAN NOT NULL DEFAULT FALSE;

-- Fetch every feed again in full straight away, so articles already kept get their content.
UPDATE reading_sources SET etag = NULL, modified = NULL, next_check_at = NOW(6);
