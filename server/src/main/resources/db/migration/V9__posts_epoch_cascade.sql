-- Account deletion removes a user's epochs and posts together; the post -> epoch key must not block that.
ALTER TABLE posts DROP FOREIGN KEY fk_posts_epoch;
ALTER TABLE posts ADD CONSTRAINT fk_posts_epoch FOREIGN KEY (epoch_id) REFERENCES epochs (id) ON DELETE CASCADE;
