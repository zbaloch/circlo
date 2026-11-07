-- Replying to a reply (owner request 2026-11-07).
-- parent_id: the reply this one answers ("Replying to @them"); emptied if that reply is deleted.
-- scope_author_id: whose circle the conversation stays in, the writer of the top reply it hangs from. An answer is
-- seen only by people who could see that top reply (PostAccess.replyVisibleTo), so the post author's answer to someone
-- in Family never reaches Close Friends. Kept when replies in between are deleted, so nothing ever opens up.
ALTER TABLE post_replies
    ADD COLUMN parent_id       BINARY(16) NULL,
    ADD COLUMN scope_author_id BINARY(16) NULL,
    ADD CONSTRAINT fk_post_replies_parent FOREIGN KEY (parent_id) REFERENCES post_replies (id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_post_replies_scope FOREIGN KEY (scope_author_id) REFERENCES users (id) ON DELETE CASCADE,
    ADD INDEX ix_post_replies_parent (parent_id);
