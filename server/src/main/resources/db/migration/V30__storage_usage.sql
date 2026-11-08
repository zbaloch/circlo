-- Storage used by an account (GET /v1/me/storage): counting my photos and videos looks attachments up by file.
CREATE INDEX ix_attachments_object_key ON attachments (object_key);
