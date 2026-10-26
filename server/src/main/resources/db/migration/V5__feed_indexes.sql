-- The timeline query finds my friends from both sides of the pair; (user_a, user_b) is already unique-indexed.
CREATE INDEX ix_friendships_b ON friendships (user_b, status);
