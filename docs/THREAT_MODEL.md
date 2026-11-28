# Circlo threat model

> **Status: v2.0, 2026-11-01.** Replaces v1.0 (end-to-end encryption). Owner decision 2026-11-01: Circlo is a
> traditional circles-based social network. Content travels over HTTPS (TLS) and is stored as sent; the server is
> trusted to enforce who may see what. In exchange, sign-up and account recovery are simple (email and password, no
> keys to lose) and a web app is possible.

## Headline guarantees

1. **Nobody sees what wasn't shared with them.** Every read of a post, reply, like, photo, chat or profile is checked
   on the server; circle names and memberships, and who a post went to, are only ever returned to their owner. The
   one exception (owner decision 2026-11-20): people in a circle whose owner lets them see each other see each other
   on the owner's profile, never the circle's name.
2. **Nobody can find you.** There is no search and no public profile; people connect with an invite link or QR code
   from the person, or from a mutual friend's profile when that friend put them in the same circle (and neither
   hid themselves). An invite link's preview shows its owner's name and photo, nothing else, to whoever has the link.
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
| Posts reach only their audience | `PostAccess.VISIBLE`: author; Everyone = current friends; circles = current friends who are in one of the post's circles now (`post_circles` × `circle_members`) | `PostsFlowIT` |
| Nobody can sort someone's posts by circle | The `audience` filter on `GET /v1/users/{id}/posts` works only on the caller's own posts (400 otherwise), so it can't be used to learn which of a friend's posts went to which circle | `ProfileAudienceFilterIT` |
| Moving someone into a circle doesn't open old posts | The snapshot is taken at post time | `PostsFlowIT` |
| Unfriend/block removes access everywhere | `People.disconnect` deletes the friendship, circle memberships and snapshot rows | `PostsFlowIT`, `SocialFlowIT` |
| Replies, likes and media follow their post | Every thread endpoint checks the post first; media URLs are only handed out inside views of visible posts | `PostsFlowIT`, `MediaFlowIT` |
| A stolen password isn't enough | Signing in from 1.1.0 needs the password and a 6-digit code emailed for that attempt (hash only, 15 minutes, 5 tries, tied to the attempt's challenge). Old store apps are password-only until `CIRCLO_LOGIN_CODE_FOR_OLD_APPS` is turned on; until then the direct API also accepts the password alone, so turn it on once 1.1.0 is out | `LoginCodeIT`, `LoginCodeForOldAppsIT` |
| Replies don't reveal other circles | On a post shared with several circles, a reply reaches only people who share one of those circles with its writer (plus the post's author); reply counts, profile Replies tabs, likes and reports follow the same rule. The post author's own replies reach the whole audience, except an answer to someone's reply, which stays in that reply's circle at any depth; "Replying to @x" is shown only to people who can see x's reply | `ReplyCirclesIT`, `ReplyThreadsIT` |
| Circle labels stay private | Audience fields are only set on the author's own posts; `/v1/circles` and circle ids in `/v1/friends` are the caller's own | `PostsFlowIT`, `SocialFlowIT` |
| Chats are members-only | Membership check on every chat call; only friends can be added | `ChatFlowIT` |
| A reply's quote shows nothing new | A reply may quote only a message in the same chat; the quote is built when it's read, so a deleted message, or one from someone the reader blocked, shows as unavailable with no text or sender | `ChatReplyIT` |
| No discovery | No search endpoint; requests need a redeemed invite from the target, or the target in one of my friends' switched-on circles with me (not hidden, no block); profiles 404 for strangers | `SocialFlowIT`, `CircleMatesIT` |
| Circle mates don't reveal circles | `/v1/users/{id}/circle-mates` only for the owner's friends; only circles with `members_visible` (owner's switch); only accepted friends of the owner; people with `show_in_circles` off and blocks either way left out; one list sorted by name, no circle id, name or grouping. The owner's preview omits how the others are connected to each other | `CircleMatesIT` |
| People you may know (Home) shows no one new | `/v1/me/people-you-may-know` is the union of my friends' circle-mates lists (same query, same rules), minus anyone I have any connection or request with; grouped by friend, no circle id or name. Closing the card is remembered on the device only | `PeopleYouMayKnowIT` |
| Invite previews show only a name and photo | `GET /v1/invites/{token}/card` (public, for the website's /i/<token> page) answers only for a current link or unused, unexpired invite of an active account, with `name` and `avatarUrl` only; anything else is 404. Tokens are 24 bytes from a keyed HMAC or random. The website's page is `noindex` and cached at most 5 minutes, so a reset link stops showing its owner within 5 minutes; nothing is logged | `InviteCardIT`, circlo-web `test/invite.test.ts` |
| Growth totals are counts only | `GET /v1/admin/growth` returns per-day counts and totals, computed from existing rows (nothing new recorded); 404 unless the caller's email is in `CIRCLO_ADMIN_EMAILS` | `GrowthIT` |
| Emails stay private | `People.Person` (name, username, photo) is the only shape returned about other people | `SocialFlowIT` |
| Password guessing is slow | Argon2id hashes; 3 failures lock login (15 min → 1 h → 24 h), per account and per typed name; per-IP limits | `AuthFlowIT`, `LoginThrottleTest` |
| No account enumeration at login | Unknown accounts answer exactly like wrong passwords (same shape, a dummy hash check) | `AuthFlowIT` |
| Email codes can't be brute-forced | 6 digits, 15 minutes, 5 guesses, single use, hashed at rest; at most 5 emails per address per hour | `AuthFlowIT` |
| Stolen refresh tokens are caught | Rotation on every use; reusing a rotated token whose replacement was already used signs out every device. Presenting it again while the replacement is still unused is a lost answer being retried (owner 2026-11-19: sessions stay put): that device gets a fresh pair and the unused token is voided | `AuthFlowIT` |
| Sessions can be ended | Sign a device out (Devices); password change signs out the others; reset signs out all | `AuthFlowIT` |
| New sign-ins are visible | Each login is recorded (time only) and shown on the other devices | `AuthFlowIT` |
| No location/device leaks in media | Photos re-encoded and EXIF/XMP/IPTC/comment segments removed; video `udta`/`meta` boxes zero-filled; on web, photos are redrawn on a canvas | `strip-metadata.test.ts` |
| Storage isn't public | Private bucket; uploads are presigned PUTs locked to size and type; downloads are presigned GETs (1 hour) | `MediaFlowIT`, `PresignedUploadIT` |
| Pushes say nothing | APNs and FCM payloads are a fixed alert ("New reply" / "New message" / "New friend request") plus a type and random ids; never names, text or counts. Sent only to the recipient, never for my own actions, never from someone the recipient blocked. Apple and Google learn *when* a device gets a push (accepted, owner decision 2026-11-01) | `EngagementFlowIT`, `ApnsSenderTest`, `FcmSenderTest` |
| Push tokens aren't readable from a DB copy | Sealed per device with AES-256-GCM (key derived from CIRCLO_JWT_KEY, bound to the device row); cleared on sign-out, revoke, or when Apple reports the token gone | `EngagementFlowIT` |
| Live updates leak nothing | `GET /v1/events` returns only a version number for the caller; the app then fetches through the usual access-checked endpoints | `EngagementFlowIT` |
| No personal data in logs | No access log; errors are fixed codes; nothing from requests is logged | `NoPayloadLoggingIT` |
| What I follow stays mine (Feeds, 2.0) | Every Feeds query (`/v1/reading/*`) starts from the caller's own follows, so another person's sources, articles and read marks are simply not there (404). Each feed is fetched once for all its followers with a generic user agent, so publishers see one Circlo fetcher, never who follows them; articles are opened on their own site only when the reader taps one. Summaries are plain text; an article's own text reaches the app only as simple blocks drawn natively (no publisher HTML, styles or scripts, no web view), with tracking pixels dropped and tracking parameters removed from links | `ReadingIT`, `FeedParserTest`, `FeedContentTest` |
| My to-dos are mine alone (Todos, 2.0) | Every Todos statement (`/v1/todos/*`) is scoped to the caller's own user id; someone else's list, to-do or note is simply not found (404), including adding to, reordering, reading the notes or completed to-dos of what isn't theirs; nothing about to-dos is logged; deleted with the account | `TodosIT` |
| My People entries (personal CRM) are mine alone (2.0) | Every `/v1/contacts/*` statement is scoped to the caller's own user id; someone else's entry, note or link is not found (404). A connection's name and photo are added only while we're connected (`People.friends`), and an entry can be linked only to a current, active connection, once. Unfriend, decline, block and account deletion drop the link both ways (`ContactLinks`), keeping the entry or letting an empty one go; the person is never told. Nothing is logged; in the export; deleted with the account | `ContactsIT` |
| One account can't exhaust the server | Every request body is capped at 2 MB before anything reads it, signed-out endpoints included (`BodySizeFilter`: 413, or a streamed body cut off at the limit); Todos writes (to-dos, notes, lists) are limited to 300 an hour per person, notes to 500 a to-do and 20,000 in all; People (personal CRM) writes likewise (300 an hour, 5,000 people, 500 notes each, 20,000 in all); OPML imports to 10 an hour; finding and following feeds to 60 an hour | `BodySizeIT`, `TodosIT`, `ContactsIT`, `ReadingIT` |
| Article images and source logos don't reveal readers (Feeds) | Images in articles, and each source's logo (`SourceIcons`), are served by `GET /v1/reading/image` from signed, expiring links (HMAC key derived from CIRCLO_JWT_KEY) that Circlo hands out only inside articles of sources the caller follows, so it isn't an open proxy; fetched through the same address checks as feeds, 10 MB cap, JPEG/PNG/GIF/WebP/AVIF and ICO only (never SVG), sent with `nosniff` and `default-src 'none'`, publisher headers and cookies dropped; kept in memory an hour | `ReadingImagesTest`, `SourceIconsTest`, `ReadingIT` |
| Feeds can't be used to reach Circlo's network | Feeds and pages are fetched only over http(s), with no user:password, and only when every address the host resolves to is public (no loopback, private, link-local/cloud metadata, shared, multicast or reserved ranges, including IPv4-mapped IPv6); redirects are followed by hand and each hop is checked again; the connection goes only to the addresses that were checked (no DNS rebinding); 10-second timeouts for headers and 15 for the body, 25 MB cap (podcast archives), big feeds parsed one at a time; feeds with a doctype are refused (no XML entities); finding and following are limited to 60 an hour per person | `UrlGuardTest`, `FeedHttpTest`, `FeedParserTest`, `ReadingIT` |
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
5. **Circle mates can be inferred into circles** (owner decision 2026-11-20). Hiding the name doesn't stop people
   guessing ("these are his family"), comparing lists ("she sees my brother but not my wife"), or noticing someone
   appear or disappear when the owner changes a circle. Mitigations: off for every circle except Family and Close
   Friends, a confirmation saying what it does whenever it's switched, anyone can hide themselves, and "See what they
   can see" shows the owner each person's list.
6. **An invite link shows who sent it** (owner request 2026-11-20). Anyone holding the link, and the chat app that
   draws its preview, sees the owner's name and photo; a link posted publicly shows them to anyone. Mitigations:
   nothing else is shown, the page isn't indexed, and resetting the link (Invite → Reset) stops it within 5 minutes.
7. **Social graph and metadata**: the server knows who is connected, who messages whom, and when.
8. **Account lockout can be triggered by others** who know your username; resetting the password by email lifts it.
9. **Screenshots and re-sharing**: anyone who can see a post can copy it. No reposts are offered.
10. **(Closed 2026-11-28) DNS rebinding against the Feeds address check.** It used to be possible for a hostile DNS
    server to answer with a public address for the check and a private one for the connection. Feeds now fetch with
    Apache HttpClient 5 and a resolver (`FeedHttp.PublicOnlyDns`) that hands out a host's addresses only if all are
    public, and the connection is made to exactly those (`FeedHttpTest`). Still worth doing in production: block the
    server's outbound traffic to private ranges and the cloud metadata address at the firewall (HARDENING.md).
11. **Opening an article or video shows the reader to its site** (Feeds, 2.0). The publisher sees the reader's IP address and
    can use its own cookies and trackers, as with any link. Mitigations: Circlo fetches feeds itself, so sites see a
    reader only when they open an article, and links lose their tracking parameters first.
12. **Playing a podcast episode shows the listener to the podcast's host** (Feeds, 2.0; owner decision 2026-11-27). The
    phone streams the episode from the podcast's own server (and any measurement prefix in its address), which sees
    its IP address, as in every podcast app; streaming through Circlo would hide it, but every Circlo listener would
    count as one download (creators' ad income) and the bandwidth would grow with listening. Mitigations: nothing is
    fetched from the host until Play is pressed (artwork comes through Circlo), the screen says "Plays from the
    podcast's own server", no cookies are sent by the player, and where you stopped stays on the phone.

## Out of scope

Malware on the user's device, a compromised operating system or browser, and physical coercion.
