-- Handle search was removed (owner decision): the only way to connect is an invite link or QR code, so there is
-- nothing left to opt into.
ALTER TABLE users DROP COLUMN discoverable;
