-- Push on Android too (owner request 2026-11-01): devices can register Firebase Cloud Messaging tokens, sealed and
-- cleared like APNs tokens (V20). Same content-free pushes.
ALTER TABLE devices MODIFY push_service ENUM('apns', 'apns_sandbox', 'fcm') NULL;
