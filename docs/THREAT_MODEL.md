# Circlo threat model

> **Status: v2.0, 2026-11-01.** Replaces v1.0 (end-to-end encryption). Owner decision 2026-11-01: Circlo is a
> traditional circles-based social network. Content travels over HTTPS (TLS) and is stored as sent; the server is
> trusted to enforce who may see what. In exchange, sign-up and account recovery are simple (email and password, no
> keys to lose) and a web app is possible.

## Headline guarantees

1. **Nobody sees what wasn't shared with them.** Every read of a post, reply, like, photo, chat or profile is checked
   on the server; circle names and memberships, and who a post went to, are only ever returned to their owner.
2. **Nobody can find you.** There is no search and no public profile; the only way to connect is an invite link or QR
   code from the person.
3. **Circlo doesn't track you.** No IPs, locations, device data, analytics or ad identifiers are collected
   (docs/PRIVACY.md), and photo/video metadata is removed on the device before upload.
4. **A database dump doesn't give away passwords.** Passwords are Argon2id hashes; codes and tokens are SHA-256 hashes.

## Assets

1. Post content and media, replies, chats.
2. Profile data (name, photo, bio) and email addresses.
3. Circle membership and labels; who each post went to.
4. Accounts: passwords, sessions, email codes.

## Adversaries

| Adversary | Capabilities |
|---|---|
| **Stranger** | Can sign up, use invite links they're given, call the API directly. |
| **Curious friend** | Connected to you; can call the API with their own session and inspect the app. |
| **Network attacker** | Observes and tampers with traffic. Production uses TLS; release apps pin the API host's keys (HARDENING.md). |
| **Account attacker** | Guesses passwords, steals a session or an email inbox. |
| **Database / bucket thief** | Gets a copy of the database, its backups or the bucket. |
| **Malicious or compelled operator** | Can read everything stored. Out of scope for technical protection since 2026-11-01; limited by policy (PRIVACY.md, LEGAL.md). |
| **Device thief** | Holds an unlocked or locked phone, or a shared computer with the web app open. |

## Guarantees and how they're enforced

| Property | Mechanism | Tests |
|---|---|---|
| Posts reach only their audience | `PostAccess.VISIBLE`: author; Everyone = current friends; circles = the audience snapshot taken when posting (`post_audience`) intersected with current friendship | `PostsFlowIT` |
| Moving someone into a circle doesn't open old posts | The snapshot is taken at post time | `PostsFlowIT` |
| Unfriend/block removes access everywhere | `People.disconnect` deletes the friendship, circle memberships and snapshot rows | `PostsFlowIT`, `SocialFlowIT` |
| Replies, likes and media follow their post | Every thread endpoint checks the post first; media URLs are only handed out inside views of visible posts | `PostsFlowIT`, `MediaFlowIT` |
| Circle labels stay private | Audience fields are only set on the author's own posts; `/v1/circles` and circle ids in `/v1/friends` are the caller's own | `PostsFlowIT`, `SocialFlowIT` |
| Chats are members-only | Membership check on every chat call; only friends can be added | `ChatFlowIT` |
| No discovery | No search endpoint; requests need a redeemed invite from the target; profiles 404 for strangers | `SocialFlowIT` |
| Emails stay private | `People.Person` (name, username, photo) is the only shape returned about other people | `SocialFlowIT` |
| Password guessing is slow | Argon2id hashes; 3 failures lock login (15 min → 1 h → 24 h), per account and per typed name; per-IP limits | `AuthFlowIT`, `LoginThrottleTest` |
| No account enumeration at login | Unknown accounts answer exactly like wrong passwords (same shape, a dummy hash check) | `AuthFlowIT` |
| Email codes can't be brute-forced | 6 digits, 15 minutes, 5 guesses, single use, hashed at rest; at most 5 emails per address per hour | `AuthFlowIT` |
| Stolen refresh tokens are caught | Rotation on every use; reusing a rotated token signs out every device | `AuthFlowIT` |
| Sessions can be ended | Sign a device out (Devices); password change signs out the others; reset signs out all | `AuthFlowIT` |
| New sign-ins are visible | Each login is recorded (time only) and shown on the other devices | `AuthFlowIT` |
| No location/device leaks in media | Photos re-encoded and EXIF/XMP/IPTC/comment segments removed; video `udta`/`meta` boxes zero-filled; on web, photos are redrawn on a canvas | `strip-metadata.test.ts` |
| Storage isn't public | Private bucket; uploads are presigned PUTs locked to size and type; downloads are presigned GETs (1 hour) | `MediaFlowIT`, `PresignedUploadIT` |
| Pushes say nothing | APNs and FCM payloads are a fixed alert ("New reply" / "New message" / "New friend request") plus a type and random ids; never names, text or counts. Sent only to the recipient, never for my own actions, never from someone the recipient blocked. Apple and Google learn *when* a device gets a push (accepted, owner decision 2026-11-01) | `EngagementFlowIT`, `ApnsSenderTest`, `FcmSenderTest` |
| Push tokens aren't readable from a DB copy | Sealed per device with AES-256-GCM (key derived from CIRCLO_JWT_KEY, bound to the device row); cleared on sign-out, revoke, or when Apple reports the token gone | `EngagementFlowIT` |
| Live updates leak nothing | `GET /v1/events` returns only a version number for the caller; the app then fetches through the usual access-checked endpoints | `EngagementFlowIT` |
| No personal data in logs | No access log; errors are fixed codes; nothing from requests is logged | `NoPayloadLoggingIT` |
| Browsers can't be abused cross-site | Bearer tokens in a header (no cookies, so no CSRF); CORS allows only the web app's origin | `AuthFlowIT` |

## Known and accepted risks

1. **The operator and anyone with database or bucket access can read content.** Mitigations: encryption at rest by
   the hosting and storage providers, restricted production access, encrypted backups, no analytics or third-party
   agents (PRIVACY.md deployment rules). Lawful requests are handled per LEGAL.md.
2. **A compromised email inbox can reset the password.** Mitigations: a reset signs out every device and shows a
   sign-in on them; the code expires in 15 minutes.
3. **The web app keeps its session in the browser's localStorage**, so script injection (XSS) in the web app could
   steal it. Mitigations: React escapes all text, no `dangerouslySetInnerHTML`, links are http(s) only, security
   headers in `app/vercel.json`; access tokens live in memory only and expire in 15 minutes.
4. **Download links can be forwarded.** A presigned media URL works for anyone for up to an hour.
5. **Social graph and metadata**: the server knows who is connected, who messages whom, and when.
6. **Account lockout can be triggered by others** who know your username; resetting the password by email lifts it.
7. **Screenshots and re-sharing**: anyone who can see a post can copy it. No reposts are offered.

## Out of scope

Malware on the user's device, a compromised operating system or browser, and physical coercion.
