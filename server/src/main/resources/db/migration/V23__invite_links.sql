-- One invite link (and QR code) per person that stays the same until they reset it (owner decision 2026-11-01). Opening
-- it connects at once. The token isn't stored: it's derived from the nonce with a server key so the owner can be shown
-- it again, and looked up by its SHA-256. Resetting picks a new nonce.
CREATE TABLE invite_links (
    user_id    BINARY(16)  NOT NULL PRIMARY KEY,
    nonce      BINARY(16)  NOT NULL,
    token_hash BINARY(32)  NOT NULL,
    created_at DATETIME(6) NOT NULL,
    CONSTRAINT uq_invite_links_token UNIQUE (token_hash),
    CONSTRAINT fk_invite_links_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- People I removed (or declined) can't come back through my link, even after a reset. Cleared when we connect again
-- some other way (I open their link).
CREATE TABLE invite_link_exclusions (
    owner_id BINARY(16) NOT NULL,
    user_id  BINARY(16) NOT NULL,
    PRIMARY KEY (owner_id, user_id),
    CONSTRAINT fk_invite_link_exclusions_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_invite_link_exclusions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- user_a joined user_b through user_b's link: user_b is told ("joined with your invite link") and asked for circles.
ALTER TABLE friendships ADD COLUMN via_link BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE email_digests ADD COLUMN friends INT NOT NULL DEFAULT 0;
