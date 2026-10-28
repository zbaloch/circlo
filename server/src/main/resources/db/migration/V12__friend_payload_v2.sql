-- Friend payload version 2 (CRYPTO.md v1.2, section 8.3) adds the exclusive-circle key slot: 192 bytes for every
-- friend. VARBINARY keeps version 1 payloads (160 bytes, older epochs) intact; BINARY(192) would zero-pad them.
-- The server accepts only 192-byte payloads for new writes, so every new payload is the same size.
ALTER TABLE friend_payloads MODIFY hpke_ciphertext VARBINARY(192) NOT NULL;
