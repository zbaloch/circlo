# What Halqo stores, and what it doesn't

Rule: Halqo collects nothing about a person except what they post for others to see, and the server can't read
even that. This page lists everything the server keeps, so it can be checked. The schema test (`SchemaIT`) fails
the build if a column for identity or tracking data is ever added, and the leaked-database drill
(`infra/leak-drill.sh`) checks a real dump.

## Never collected

| Never collected | How it's enforced |
|---|---|
| Email addresses, phone numbers, real names | There are no such fields. Sign-up is a handle and a password, and the password never leaves the phone (OPAQUE). Display names are end-to-end encrypted. |
| IP addresses | Not stored or logged anywhere. Tomcat's access log is off. The login rate limiter keeps a salted hash (random salt per server start) in memory for one minute, then forgets it. |
| Location, device model, OS, language, time zone, contacts | The app doesn't ask for them. Photo/video metadata (GPS, camera) is stripped on the phone before encryption. |
| Analytics, crash reports, ads, install attribution | No analytics, crash-reporting or ad SDKs. Android: install-referrer and advertising-ID permissions are stripped from the build. iOS: the privacy manifest declares no tracking and no collected data. |
| "Last seen", online status, read receipts | Nothing records when someone was last active. |
| Request bodies, decrypted content | Never logged (`NoPayloadLoggingIT`). |

## What the server keeps (all needed for the app to work)

| Data | Form | Why |
|---|---|---|
| Account | Random id, keyed HMAC of the handle (not the handle), OPAQUE record, signup time | Log in, and let friends find you if you opt in |
| Keys | Public keys; private keys only inside backups encrypted on the phone | Friends verify you; you can recover your account with your 24 words |
| Devices | Random id, public key, push token (encrypted with a server key), created/revoked times | Deliver to and revoke your phones |
| Friends and blocks | Pairs of random ids, status, time | Who can fetch whose (encrypted) posts |
| Posts, replies, likes | Encrypted content, padded sizes, times; a hash of each post's read token | Show posts to the people you chose. The audience is not visible to the server |
| Photos and videos | Encrypted files with random names in the bucket | Media in posts and chats |
| Chats | MLS ciphertext, deleted after 30 days; group membership by device id | Deliver messages |
| Address book, profile | Encrypted blobs only you (or your friends, for the profile) can open | Your names for friends and circles, your profile |

Deleting an account removes all of it: every row, and every file in the bucket.

## Who else sees something

- **Apple / Google push**: that a device got a "new activity" notification. No content, names or counts.
- **The hosting provider and the storage (S3) provider** see IP addresses of connections at the network level. Our
  code doesn't record them, but their logs might (see the deployment rules below).

## Deployment rules (production)

These keep the guarantee true outside our code:

1. **No access logs anywhere in front of the server**: turn off access logging on the reverse proxy, load balancer
   or CDN, or at least drop the client IP and request line (e.g. nginx `access_log off;`).
2. **No storage access logs**: don't enable S3 server-access logging, CloudTrail data events or MinIO audit logs on
   the media bucket.
3. **No APM or analytics agents** on the server (they capture IPs and request data by default).
4. **Database backups are encrypted.** They hold only ciphertext and hashes, but they also hold the social graph.
5. Keep the server's secrets (OPAQUE setup, handle/JWT/push keys) in a secret store, separate from database
   backups.
