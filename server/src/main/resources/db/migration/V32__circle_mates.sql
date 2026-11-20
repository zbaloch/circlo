-- People in the same circle see each other (owner decision 2026-11-20). On a friend's profile I see the others who
-- share one of their circles with me, never which circle. Each owner switches it on or off per circle: Family and
-- Close Friends start on, every other circle off. Each person can hide themselves from these lists.
ALTER TABLE circles ADD COLUMN members_visible BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE circles SET members_visible = TRUE WHERE LOWER(name) IN ('family', 'close friends');

ALTER TABLE users ADD COLUMN show_in_circles BOOLEAN NOT NULL DEFAULT TRUE;
