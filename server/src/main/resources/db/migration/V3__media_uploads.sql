-- Upload slots handed out with presigned PUT URLs. An object can be attached to a post only by its uploader, once,
-- and only if it exists in the bucket with the declared (padded, encrypted) size. Object keys are 32 random bytes (hex).
CREATE TABLE media_uploads (
    object_key CHAR(64)    NOT NULL PRIMARY KEY,
    owner_id   BINARY(16)  NOT NULL,
    ct_size    BIGINT      NOT NULL,
    created_at DATETIME(6) NOT NULL,
    post_id    BINARY(16)  NULL,
    INDEX ix_media_uploads_owner (owner_id, created_at),
    CONSTRAINT fk_media_uploads_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);
