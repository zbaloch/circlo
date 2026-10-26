-- MLS delivery service (CRYPTO.md 13a): an opaque relay. The server sees group ids, member device ids, epochs and
-- ciphertext sizes; never names or message content.
ALTER TABLE mls_key_packages ADD COLUMN last_resort BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE mls_key_packages ADD COLUMN created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);

ALTER TABLE mls_groups ADD COLUMN epoch BIGINT NOT NULL DEFAULT 0;

-- Which devices may fetch and post (kept in step with the MLS membership by the committing client).
CREATE TABLE mls_group_members (
    group_id  BINARY(16)  NOT NULL,
    device_id BINARY(16)  NOT NULL,
    user_id   BINARY(16)  NOT NULL,
    added_at  DATETIME(6) NOT NULL,
    PRIMARY KEY (group_id, device_id),
    INDEX ix_mls_group_members_device (device_id),
    CONSTRAINT fk_mls_members_group FOREIGN KEY (group_id) REFERENCES mls_groups (id) ON DELETE CASCADE,
    CONSTRAINT fk_mls_members_device FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
);

ALTER TABLE mls_welcomes ADD COLUMN group_id BINARY(16) NOT NULL;
ALTER TABLE mls_welcomes ADD COLUMN after_seq BIGINT NOT NULL DEFAULT 0;
CREATE INDEX ix_mls_welcomes_device ON mls_welcomes (recipient_device_id);
