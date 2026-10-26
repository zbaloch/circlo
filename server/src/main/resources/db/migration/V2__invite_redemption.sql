-- Who redeemed an invite. Friend requests are accepted only from someone who redeemed the target's invite,
-- or to a target who opted into handle search (users.discoverable). Stops strangers spamming requests.
ALTER TABLE invites
    ADD COLUMN redeemed_by BINARY(16) NULL,
    ADD CONSTRAINT fk_invites_redeemed_by FOREIGN KEY (redeemed_by) REFERENCES users (id) ON DELETE CASCADE;

CREATE INDEX ix_invites_inviter ON invites (inviter_id);
