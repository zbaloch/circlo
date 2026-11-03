-- New starter circles (owner decision 2026-11-03): 1 Family (starred), 2 Close Friends, 3 School, 4 Work,
-- 5 Acquaintances. Accounts made before then move over without changing who sees what. Circles their owner renamed
-- are left alone.

-- 1. Close Friends (1) and Family (2), both still with their starter names, swap places. Their people and the posts
--    shared with them move too, so Family's people stay in Family and the posts keep reaching the same people.
CREATE TEMPORARY TABLE v26_owners (owner_id BINARY(16) NOT NULL PRIMARY KEY);
INSERT INTO v26_owners (owner_id)
SELECT a.owner_id
FROM circles a
JOIN circles b ON b.owner_id = a.owner_id AND b.id = 2 AND b.name = 'Family'
WHERE a.id = 1 AND a.name = 'Close Friends';

CREATE TEMPORARY TABLE v26_members AS
SELECT m.owner_id, 3 - m.circle_id AS circle_id, m.member_id
FROM circle_members m
JOIN v26_owners o ON o.owner_id = m.owner_id
WHERE m.circle_id IN (1, 2);
DELETE m FROM circle_members m JOIN v26_owners o ON o.owner_id = m.owner_id WHERE m.circle_id IN (1, 2);
INSERT INTO circle_members (owner_id, circle_id, member_id) SELECT owner_id, circle_id, member_id FROM v26_members;

CREATE TEMPORARY TABLE v26_posts AS
SELECT pc.post_id, 3 - pc.circle_id AS circle_id
FROM post_circles pc
JOIN posts p ON p.id = pc.post_id
JOIN v26_owners o ON o.owner_id = p.author_id
WHERE pc.circle_id IN (1, 2);
DELETE pc FROM post_circles pc
JOIN posts p ON p.id = pc.post_id
JOIN v26_owners o ON o.owner_id = p.author_id
WHERE pc.circle_id IN (1, 2);
INSERT INTO post_circles (post_id, circle_id) SELECT post_id, circle_id FROM v26_posts;

UPDATE circles c
JOIN v26_owners o ON o.owner_id = c.owner_id
SET c.name = IF(c.id = 1, 'Family', 'Close Friends')
WHERE c.id IN (1, 2);

DROP TEMPORARY TABLE v26_posts;
DROP TEMPORARY TABLE v26_members;
DROP TEMPORARY TABLE v26_owners;

-- 2. Kids becomes School. Its people stay in it, as with any rename.
UPDATE circles SET name = 'School' WHERE id = 3 AND name = 'Kids';

-- 3. Acquaintances, in the lowest free id (as when someone adds a circle; 5 for untouched accounts), for signed-up
--    accounts that have room left (8 circles at most) and no Acquaintances yet. Each insert skips the accounts an
--    earlier one already gave it to.
INSERT INTO circles (owner_id, id, name, created_at)
SELECT u.id, 1, 'Acquaintances', UTC_TIMESTAMP(6) FROM users u
WHERE u.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM circles c WHERE c.owner_id = u.id AND (c.id = 1 OR c.name = 'Acquaintances'));
INSERT INTO circles (owner_id, id, name, created_at)
SELECT u.id, 2, 'Acquaintances', UTC_TIMESTAMP(6) FROM users u
WHERE u.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM circles c WHERE c.owner_id = u.id AND (c.id = 2 OR c.name = 'Acquaintances'));
INSERT INTO circles (owner_id, id, name, created_at)
SELECT u.id, 3, 'Acquaintances', UTC_TIMESTAMP(6) FROM users u
WHERE u.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM circles c WHERE c.owner_id = u.id AND (c.id = 3 OR c.name = 'Acquaintances'));
INSERT INTO circles (owner_id, id, name, created_at)
SELECT u.id, 4, 'Acquaintances', UTC_TIMESTAMP(6) FROM users u
WHERE u.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM circles c WHERE c.owner_id = u.id AND (c.id = 4 OR c.name = 'Acquaintances'));
INSERT INTO circles (owner_id, id, name, created_at)
SELECT u.id, 5, 'Acquaintances', UTC_TIMESTAMP(6) FROM users u
WHERE u.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM circles c WHERE c.owner_id = u.id AND (c.id = 5 OR c.name = 'Acquaintances'));
INSERT INTO circles (owner_id, id, name, created_at)
SELECT u.id, 6, 'Acquaintances', UTC_TIMESTAMP(6) FROM users u
WHERE u.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM circles c WHERE c.owner_id = u.id AND (c.id = 6 OR c.name = 'Acquaintances'));
INSERT INTO circles (owner_id, id, name, created_at)
SELECT u.id, 7, 'Acquaintances', UTC_TIMESTAMP(6) FROM users u
WHERE u.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM circles c WHERE c.owner_id = u.id AND (c.id = 7 OR c.name = 'Acquaintances'));
INSERT INTO circles (owner_id, id, name, created_at)
SELECT u.id, 8, 'Acquaintances', UTC_TIMESTAMP(6) FROM users u
WHERE u.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM circles c WHERE c.owner_id = u.id AND (c.id = 8 OR c.name = 'Acquaintances'));
