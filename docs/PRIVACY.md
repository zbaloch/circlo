# What Circlo stores, and what it doesn't

Rule: Circlo keeps what people give it to use the app (their account, and what they post for others), and
nothing that tracks them. This page lists everything the server keeps, so it can be checked. The schema test
(`SchemaIT`) fails the build if a tracking column is ever added or a password column holds anything but a hash, and
`NoPayloadLoggingIT` checks that real traffic leaves nothing personal in the logs.

Owner decision 2026-11-01: Circlo is no longer end-to-end encrypted. Content is protected in transit by HTTPS (TLS)
and stored as sent; the server decides who may see it. This keeps sign-up and recovery simple (no keys or phrases to
lose) and makes the web app possible.

## Never collected

| Never collected | How it's enforced |
|---|---|
| Phone numbers, contacts, address book uploads | There are no such fields, and the app never asks for contacts. |
| IP addresses | Not stored or logged anywhere. Tomcat's access log is off. The login rate limiter keeps a salted hash (random salt per server start) in memory for one minute, then forgets it. |
| Location, device model, OS, language, time zone | The app doesn't ask for them. Photo/video metadata (GPS, camera) is removed on the device before upload. |
| Analytics, crash reports, ads, install attribution | No analytics, crash-reporting or ad SDKs. Android: install-referrer and advertising-ID permissions are stripped from the build. iOS: the privacy manifest declares no tracking. |
| "Last seen", online status | Nothing records when someone was last active. Read state in chats is a message number, not a time. |
| Passwords | Only an Argon2id hash is stored; the password itself is never stored or logged. |
| Request bodies, codes | Never logged (`NoPayloadLoggingIT`). |

## What the server keeps (all needed for the app to work)

| Data | Form | Why |
|---|---|---|
| Account | Random id, name, @username, email, Argon2id password hash, bio, photo, signup time, when the email was verified | Sign in, reset a forgotten password, show your profile to your people |
| Email codes | A hash of the latest 6-digit code, its purpose and expiry (15 minutes) | Confirm your email, reset your password |
| Unfinished signups | As above, deleted after a day if the email is never confirmed | Finish signing up |
| Devices | Random id, signed-in and signed-out times; if background checks are on, a hash of the device's check token | List and sign out your devices; answer "anything new?" with counts |
| Sessions | Hashes of refresh tokens, per device, until they expire (30 days) | Stay signed in |
| Sign-ins | The time of each login (no device, place or address), kept 30 days | Warn your other devices: "New sign-in to your account" |
| Login lock | Per account (or per typed name, if no account matches): failed-attempt count and lock time, deleted a week after the last failure | Lock login after 3 wrong passwords (15 min, 1 h, then 24 h) |
| Friends, invites, blocks | Pairs of ids, status, time; invite tokens only as hashes | Who is connected with whom |
| Circles | Your circle names and who is in them | Choose who sees each post. Shown only to you |
| Posts, replies, likes | Text, times, who wrote or liked them; each post's audience (and, for circle posts, who it reached) | Show posts to the people you chose. The audience is shown only to you |
| Photos and videos | Files with random names in a private bucket, served through links that expire after an hour | Media in posts, chats and profile photos |
| Chats | Members, messages, and how far each member has read | Deliver messages, show unread counts on every device |
| Reports | What was reported (a copy of the text as it was), the reason and note, who reported it | Moderation, required by the app stores |

Deleting an account removes all of it: every row, and every file in the bucket. Reports about you are kept (without
a link to your account) and your reports lose their link to you.

## Who else sees something

- **Apple / Google: nothing.** There is no remote push (owner decision 2026-10-30). A phone that opts in checks Circlo
  itself in the background and shows a local notification with counts.
- **The email provider** sees your email address and the codes Circlo sends you (nothing else).
- **The hosting provider and the storage (S3) provider** see IP addresses of connections at the network level, and
  hold the stored data. Our code doesn't record IPs, but their logs might (see the deployment rules below).

## Deployment rules (production)

These keep the rules true outside our code:

1. **No access logs anywhere in front of the server**: turn off access logging on the reverse proxy, load balancer
   or CDN, or at least drop the client IP and request line (e.g. nginx `access_log off;`).
2. **No storage access logs**: don't enable S3 server-access logging, CloudTrail data events or MinIO audit logs on
   the media bucket.
3. **No APM or analytics agents** on the server or the web app (they capture IPs and request data by default).
4. **Encryption at rest for the database, its backups and the bucket** (the provider's disk/volume encryption and
   S3 server-side encryption), and restricted access to all three: they now hold content as written.
5. Keep the server's secrets (JWT key, SMTP credentials, bucket keys) in a secret store, separate from backups.
