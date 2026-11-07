-- When a friend request was accepted (owner request 2026-11-07): the person who asked is told "X accepted your
-- request" in Notifications. Empty for links (connected at once) and for requests accepted before this.
ALTER TABLE friendships ADD COLUMN accepted_at DATETIME(6) NULL;
