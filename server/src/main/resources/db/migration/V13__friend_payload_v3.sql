-- Friend payload version 3 (CRYPTO.md v1.3, section 8.3): the Everyone key plus 8 circle-key slots, 416 bytes for
-- every friend. Older payloads (160 and 192 bytes) stay readable for older epochs.
ALTER TABLE friend_payloads MODIFY hpke_ciphertext VARBINARY(416) NOT NULL;
