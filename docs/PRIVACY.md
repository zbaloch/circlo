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
| Account | Random id, name, @username, email, Argon2id password hash, bio, photo, signup time, when the email was verified, and whether people in the same circles of a friend may see you | Sign in, reset a forgotten password, show your profile to your people |
| Email codes | A hash of the latest 6-digit code, its purpose and expiry (15 minutes) | Confirm your email, reset your password |
| Unfinished signups | As above, deleted after a day if the email is never confirmed | Finish signing up |
| Devices | Random id, signed-in and signed-out times, which kind of app it is (iPhone app, Android app or web browser: no model, OS version or browser name); if notifications are on, the push token sealed with a server key, or a hash of the background-check token | List and sign out your devices; push messages, replies, friend requests and new friends to your phone as they happen |
| Notifications | Your choices: the daily email, and which pushes your phones get (messages, replies, friend requests and new friends, the daily reminder); the hour (UTC) your app chose for "around 6pm" (a setting: no time zone or location), when the last reminder went out, and until the next one how many new posts from your circles, replies, messages, requests and friends are waiting (counts only, never sent) | One calm reminder a day, only on days something happened, by push and by email as you chose |
| Sessions | Hashes of refresh tokens, per device, until they expire (30 days) | Stay signed in |
| Sign-ins | The time of each login (no device, place or address), kept 30 days | Warn your other devices: "New sign-in to your account" |
| Login lock | Per account (or per typed name, if no account matches): failed-attempt count and lock time, deleted a week after the last failure | Lock login after 3 wrong passwords (15 min, 1 h, then 24 h) |
| Friends, invites, blocks | Pairs of ids, status, time, whether someone joined with your link; invite tokens only as hashes (your permanent link is derived from a random value with a server key, never stored); people you removed, so your link stops working for them | Who is connected with whom |
| Circles | Your circle names, who is in them, and whether each circle's people see each other | Choose who sees each post. The names are shown only to you; in circles where you let people see each other (Family and Close Friends unless you turn it off), they see each other on your profile, never which circle |
| Posts, replies, likes | Text, times, who wrote or liked them; each post's audience (for circle posts, which of your circles) | Show posts to the people you chose. The audience is shown only to you |
| Photos and videos | Files with random names in a private bucket, served through links that expire after an hour | Media in posts, chats and profile photos |
| Chats | Members, messages, and how far each member has read | Deliver messages, show unread counts on every device |
| Feeds (2.0) | The web feeds you follow (blogs, newsletters, YouTube channels, podcasts) and when you followed them; which articles you've opened or marked read; when you last opened Feeds (for the drawer's dot). Feeds themselves (address, name, the address of its logo, the latest articles' titles, summaries, links and the text and picture addresses the feed carries; articles older than 60 days are let go beyond each source's newest 100) are stored once for everyone who follows them; pictures are fetched by Circlo when shown and kept in memory for an hour, never stored | Show you what's new from the sites you follow. What you follow is shown only to you, is in your data export, and goes with your account |
| Reports | What was reported (a copy of the text as it was), the reason and note, who reported it | Moderation, required by the app stores |

Deleting an account removes all of it: every row, and every file in the bucket. Reports about you are kept (without
a link to your account) and your reports lose their link to you.

## Who else sees something

- **Apple / Google** deliver pushes to a phone that turned notifications on, so they learn when something happened for
  you. Each push is a fixed text: "New message", "New reply", "New friend request", "Your friend request was
  accepted", "Someone joined with your invite link", a security alert ("New sign-in to your account" and the like), or
  the daily note "You have a few new things waiting. Catch up when you're ready.". Messages and replies also carry the
  chat's, post's or reply's random id so a tap opens it. Never names, words or counts (owner decision 2026-11-18).
- **Anyone you send your invite link to**, and the chat app that draws the link's preview (WhatsApp, iMessage and the
  like), sees your name and profile photo, nothing else (owner request 2026-11-20). The website (Vercel) builds that
  preview from `GET /v1/invites/<token>/card` and keeps nothing; resetting your link stops it within 5 minutes.
- **Circlo's admins** (accounts listed in `CIRCLO_ADMIN_EMAILS`) see daily totals: sign-ups, invite joins,
  connections, posts and replies. Counts only, computed from what's stored anyway; never who.
- **The email provider** sees your email address and what Circlo emails you: codes, the daily note if you don't have
  the app (the kinds of things waiting, never who, what or how many), and security emails straight away (a new
  sign-in, a password change, another device signed out from your Devices list, naming only the kind of device: never where from).
- **The sites you follow in Feeds** (YouTube included) see one Circlo server fetching their feed, their logo and the pictures in
  their articles, never who follows or reads them. When you tap through to the original you're on their site, so they see your IP address and their own cookies apply, as with any link. When you play a podcast episode, your phone streams it from the podcast's own server, which sees your IP address as with any podcast app (so creators' download counts stay right). Where you stopped in each episode is kept only on your phone and forgotten when you sign out. Links
  lose their tracking parameters first.
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
