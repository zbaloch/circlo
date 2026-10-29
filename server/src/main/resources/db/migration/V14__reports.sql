-- Reports to the operator are back (owner decision 2026-10-29; V10 had dropped them). The reporter's phone seals each
-- report to the operator's moderation key, with its id bound into the AAD (CRYPTO.md 13c); the server stores
-- ciphertext only. A deleted account's reports stay, without the reporter.
CREATE TABLE reports (
    id          BINARY(16)  NOT NULL PRIMARY KEY,
    reporter_id BINARY(16)  NULL,
    sealed      MEDIUMBLOB  NOT NULL,
    created_at  DATETIME(6) NOT NULL,
    CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE SET NULL
);
