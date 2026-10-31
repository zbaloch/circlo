-- Recovery methods (docs/PASSKEY_RECOVERY.md, CRYPTO.md 6.3/6.4): a user has one or more ways back in besides the
-- password, each a public key (checked at recovery login) and a recovery copy of the key backup. kind 'phrase' is the
-- 12/24-word phrase, 'passkey' a passkey's PRF-derived key (several rows may wrap the same passkey). The server can't
-- tell how a key was derived; it stores no passkey data.
CREATE TABLE recovery_methods (
    id           BINARY(16)                 NOT NULL PRIMARY KEY,
    user_id      BINARY(16)                 NOT NULL,
    kind         ENUM('phrase', 'passkey')  NOT NULL,
    auth_pubkey  BINARY(32)                 NOT NULL,
    ciphertext   MEDIUMBLOB                 NOT NULL,
    created_at   DATETIME(6)                NOT NULL,
    last_used_at DATETIME(6)                NULL,
    INDEX idx_recovery_methods_user (user_id, created_at),
    CONSTRAINT fk_recovery_methods_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Existing accounts: their phrase becomes their first method.
INSERT INTO recovery_methods (id, user_id, kind, auth_pubkey, ciphertext, created_at)
SELECT UNHEX(REPLACE(UUID(), '-', '')), u.id, 'phrase', u.recovery_pubkey, b.ciphertext, u.created_at
FROM users u
JOIN key_backups b ON b.user_id = u.id AND b.kind = 'recovery'
WHERE u.recovery_pubkey IS NOT NULL;

DELETE FROM key_backups WHERE kind = 'recovery';
ALTER TABLE users DROP COLUMN recovery_pubkey;

-- A one-time proof of the current password (from /v1/auth/password/verify), needed to remove a recovery method.
ALTER TABLE users ADD COLUMN reauth_hash BINARY(32) NULL;
ALTER TABLE users ADD COLUMN reauth_expires_at DATETIME(6) NULL;
