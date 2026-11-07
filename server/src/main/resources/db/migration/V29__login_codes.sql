-- A second factor at login (owner decision 2026-11-07): after the right password, a 6-digit code by email. The code is
-- tied to the attempt that passed the password (a hash of its one-time challenge), so only that device can use it.
-- Codes for apps already in the stores (CIRCLO_LOGIN_CODE_FOR_OLD_APPS) have no challenge: their screen sends only the
-- email address and the code.
ALTER TABLE email_codes
    MODIFY purpose ENUM('verify', 'reset', 'login') NOT NULL,
    ADD COLUMN challenge_hash BINARY(32) NULL;
