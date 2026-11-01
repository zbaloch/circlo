-- A circle post is seen by whoever is in its circles now, not by who was in them when it was posted (owner decision
-- 2026-11-01): taking someone out of a circle closes its posts to them, and putting them back opens them again. The
-- audience comes from post_circles and circle_members, so the posting-time snapshot goes.
DROP TABLE post_audience;
