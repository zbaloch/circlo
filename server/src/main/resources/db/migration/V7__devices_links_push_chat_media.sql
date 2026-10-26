-- Phase 10: device linking, push tokens, chat attachments.

-- One-time device-link hand-off (CRYPTO.md 13b): the old device uploads the account secrets sealed to the new
-- device's QR key; the new device fetches it once by the random link id. Expires after 10 minutes.
CREATE TABLE device_links (
    link_id    BINARY(32)  NOT NULL PRIMARY KEY,
    user_id    BINARY(16)  NOT NULL,
    sealed     BLOB        NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    CONSTRAINT fk_device_links_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- 'android' (FCM) or 'ios' (APNs); the token itself stays sealed in devices.push_token_enc.
ALTER TABLE devices ADD COLUMN push_platform VARCHAR(8) NULL;

-- Media sent in a chat belongs to the group: only its members may download it.
ALTER TABLE media_uploads ADD COLUMN group_id BINARY(16) NULL;
CREATE INDEX ix_media_uploads_group ON media_uploads (group_id);
