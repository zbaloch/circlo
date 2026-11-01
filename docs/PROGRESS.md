# Circlo build progress

Memory file for Claude Code sessions. Read this first when resuming. Keep it accurate.

## 2026-11-01: no more end-to-end encryption (branch `plain-accounts`)

Owner decision: Circlo becomes a traditional circles-based social network, so people can't lock themselves out by
losing keys or a phrase, and a web app is possible. The user experience stays the same.

- **Server**: V18 drops every table of the encrypted design and creates a plain schema. Accounts (name, username,
  email, Argon2id password hash, bio, photo), signup finished with an emailed 6-digit code, login by username or
  email, password reset by code, devices and rotating sessions, circles and memberships, posts with an audience
  snapshot, replies, likes, chats with read state, attachments, reports with a copy of the content. CORS for the web
  app. 52 tests (`mvn verify`, MariaDB + MinIO).
- **App**: the same screens on plain API data; new signup / verify email / login / forgot password screens; photo
  upload in Edit profile; Devices = signed-in sessions; recovery, linking, safety numbers and the crypto self-test
  removed. Web app via Expo's static web export (`npm run build:web`, `app/vercel.json`). 104 tests, lint, typecheck.
- **Removed**: `core/`, `app/modules/circlo-core`, ubrn, react-native-passkey, docs/CRYPTO.md, docs/PASSKEY_RECOVERY.md,
  the leak drill, ci-core, cargo audits. THREAT_MODEL.md v2.0, PRIVACY.md, HARDENING.md, LEGAL.md rewritten.
- **Existing dev/test accounts start over** (nothing encrypted could be migrated). Empty the media bucket once.

### Waiting on owner (2026-11-01)

1. **SMTP provider** for production (Postmark, SES, Resend, ...): set `CIRCLO_MAIL_HOST`, `CIRCLO_MAIL_PORT`,
   `CIRCLO_MAIL_USERNAME`, `CIRCLO_MAIL_PASSWORD`, `CIRCLO_MAIL_FROM` in the server's secret store, and set up SPF,
   DKIM and DMARC for the sending domain.
2. **Web app hosting**: a Vercel project on `app/` (root directory `app`, uses `app/vercel.json`), the domain
   `app.hellocirclo.com`, and `EXPO_PUBLIC_API_URL` set to the API's HTTPS URL at build time.
3. **CORS**: `CIRCLO_CORS_ORIGINS=https://app.hellocirclo.com` on the server, and the same origin allowed on the
   bucket (S3 CORS rule for GET and PUT with `Content-Type`), or the web app can't upload or show photos.
4. Empty the old ciphertext out of the media bucket (V18 leaves it unreferenced).
5. Turn on encryption at rest for the database, backups and bucket (HARDENING.md, "Data at rest").
6. The App Store Connect / Play listings and the website copy no longer say "end-to-end encrypted" (website updated
   on branch `plain-accounts` of circlo-web); update the store descriptions and the privacy "nutrition labels"
   (now: email, name, user content, linked to the user).
7. Rewrite the load test for the new API (HARDENING.md).

### Needs manual check (2026-11-01)

- Phone and web: sign up (code arrives by email), log in by username and by email, forgot password, change password
  (other device signed out), add/change/remove photo, invite by link and QR, accept into circles, post to a circle
  and check a friend outside it can't see it, chat with photos, report, block, delete account.
- Web app: everything above in a desktop and a phone browser, including photo upload (needs bucket CORS) and opening
  `https://app.hellocirclo.com/i/<token>`.

## Current status

| Phase | Status |
|---|---|
| 0 Repo, spec, local infra | Done (merged PR #2); phone check still manual |
| 1 Rust crypto core | Done (merged PR #3) |
| 2 RN binding + app shell | Done on Android (merged PR #4); iPhone EAS build pending owner's Expo/Apple accounts |
| 3 Server foundations | Done (merged PR #5) |
| 4 App onboarding | Done on Android (merged PR #6) |
| 5 Friends | Done on Android (merged PR #7) |
| 6 Circles | Done on Android (merged PR #8) |
| 7 Posts and media | Done on Android (merged PR #9) |
| 8 Timeline, threads, replies, likes, profiles | Done on Android (merged PR #10) |
| 9 Messaging (MLS) | Done on Android (merged PR #11; attachments finished in Phase 10) |
| 10 Multi-device and push | Done on Android (merged PR #12) |
| 11 Safety, abuse, legal | Done on Android (merged PR #13) |
| 12 Hardening | Done (merged PR #14); external crypto audit still required before launch |

## Final summary (all phases, 2026-10-27)

**What's built.** Circlo is an end-to-end encrypted, circles-based social app: a Twitter-style timeline, threads,
replies, likes, profiles and DMs. Posts go only to the circles the author picks, and the server can't tell which.

- **Core (Rust, `circlo-core`)**: every cryptographic step:
  - XChaCha20-Poly1305 with AAD binding everywhere; Padmé padding;
  - HKDF circle chains with per-post keys and read tokens; HPKE friend payloads; Ed25519 signatures;
  - STREAM media encryption; OPAQUE login; BIP39 recovery;
  - MLS messaging (OpenMLS); QR device linking.

  It is bound to the app (uniffi/JSI) and to the server (JNI). It is fuzzed in CI, and the release build is
  reproducible.
- **Server (Spring Boot 4, MariaDB, S3/MinIO)**:
  - stores only ciphertext, hashes and opaque ids; no names, emails, phone numbers, plaintext handles, circle
    numbers or IPs;
  - content-free push;
  - account deletion that leaves no trace;
  - rate limits.

  It has 50 integration tests plus an on-demand load test (919 req/s locally).
- **App (Expo SDK 58, Android verified on emulators)**:
  - signup and login with a 24-word recovery phrase;
  - invites and safety numbers;
  - circles with key rotation;
  - posts with photos and video (metadata stripped, encrypted on the phone);
  - a timeline and threads;
  - MLS chats with attachments;
  - linking devices by QR, and revoking them;
  - block and mute;
  - data export;
  - account deletion;
  - certificate pinning and a rooted-phone warning in release builds.
- **Proven**: the leaked-database drill finds nothing readable in a dump of the database, the bucket and the server
  log. Pushes carry no content (tested). Each phase's flows were checked on emulators (see each phase below).

**Still needs checking on real devices**: everything under "Needs manual check". Most importantly: iOS has never
run; push on locked phones; video recorded on a real phone; performance on a mid-range Android release build; and
pinning against the real HTTPS host.

**Must happen before a public launch**:

1. An **external cryptography audit** of /core and docs/CRYPTO.md (non-negotiable for an E2EE claim), plus a
   penetration test of the server and app.
2. A **legal review** (docs/LEGAL.md): platform liability, CSAM and lawful-access duties, GDPR, export controls, and
   app-store rules on reporting user content, since in-app reporting was removed.
3. Production infrastructure:
   - secrets in a secret store (OPAQUE setup, handle/JWT/push keys);
   - TLS with pinned keys plus an offline backup key;
   - a dedicated database user and encrypted backups;
   - FCM/APNs credentials;
   - Rust in the EAS build image.
4. The items under "Waiting on owner".

## Environment (as of 2026-10-25)

- **Windows is the main dev platform (owner decision).** Repo at `C:\Users\zaheer\code\circlo`; public GitHub repo
  `zbaloch/circlo`, default branch `main`.
- Windows tools: git, gh (logged in as `zbaloch`), Java 21, Maven 3.9.12, Node 24, Python 3.12, pre-commit 4.7
  (`python -m pre_commit`), Rust via rustup (`%USERPROFILE%\.cargo\bin`, not on Git Bash PATH by default) with
  cargo-ndk and Android targets, VS Build Tools 2022. No `make`.
- Debian WSL2 (mirrored networking): MariaDB 11.8.6 (bound to 127.0.0.1, reachable from Windows at localhost:3306),
  Docker 26.1 with the owner's MinIO container **`minio`** (`cgr.dev/chainguard/minio`), reached at `http://<LAN_IP>:9000`.
  `infra/.env` sets `MINIO_CONTAINER=minio` so dev-up reuses it.
- **WSL idles out** ~1 min after the last WSL process exits, stopping MariaDB/MinIO. `infra/dev-up.ps1` starts a keep-alive.
  If tests fail with ConnectException, run `.\infra\dev-up.ps1` first.
- `server/.env` currently uses the MariaDB `root` account (should be the `circlo` user, see owner questions).
- Owner's MinIO also has unrelated buckets `circlo`, `myapp` — leave them alone.

## Phase 0 plan

- [x] Root `CLAUDE.md`, `.gitignore`, `.pre-commit-config.yaml`, `.gitleaks.toml`, `.editorconfig`
- [x] `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `Makefile`, `LICENSE` (AGPL-3.0)
- [x] `core/`, `server/`, `app/` `CLAUDE.md`
- [x] `.github/workflows/` (ci-core, ci-server, ci-app with path filters; secret-scan gitleaks), `dependabot.yml`, `CODEOWNERS`
- [x] `infra/docker-compose.yml` (MinIO only, Chainguard image), `infra/dev-up.sh`, `infra/dev-up.ps1`, `.env.example`s
- [x] Server skeleton: S3 presigner (public endpoint, path-style), `/dev/presign-put` (profile `local` only)
- [x] Server tests (7, all passing locally): `MediaUrlSignerTest` (3), `DevPresignControllerTest` (1),
      `DatabaseConnectivityIT` (circlo_test), `PresignedUploadIT` (2: PUT/GET round trip, unsigned → 403)
- [x] Smoke test: server with profile `local` connects to the `circlo` DB (Flyway history table created);
      `/dev/presign-put` → PUT/GET via `http://<LAN_IP>:9000/circlo-media` works from Windows
- [x] Buckets `circlo-media`, `circlo-media-test` created (private)
- [x] `docs/CRYPTO.md` (draft), `docs/THREAT_MODEL.md` (draft), `docs/DEV_SETUP.md` (Windows-first), `docs/api/openapi.yaml` stub
- [ ] `pre-commit run --all-files` clean, PR `phase-0-foundation` merged with CI green
- [ ] Owner: MinIO console + presigned PUT from a phone (see "Needs manual check")
- [ ] Owner: review/approve CRYPTO.md and THREAT_MODEL.md

## Phase 1 (Rust crypto core) — summary

- [x] CRYPTO.md v1.0 + THREAT_MODEL v1.0 approved (owner delegated: "most secure option")
- [x] `core/` crate `circlo-core`: AEAD envelope, Padmé, circle chain + per-post key refs, identity/device keys,
      HPKE Auth friend payloads, posts/replies with author signatures, chunked media STREAM, backups,
      BIP39 recovery, OPAQUE client and server, encrypted blobs, push-token sealing, handle lookup, invites, safety numbers, uniffi FFI
- [x] 59 tests: unit, `tests/flows.rs` (signup A → login B same identity; circle 7 reads 7/9 not 5; 7→9 epoch
      rotation closes new circle-7 posts; replies; media), `tests/tamper.rs` (property tests, every ciphertext type)
- [x] Test vectors committed (`core/test_vectors/vectors_TEST_ONLY.json`) + published vectors (RFC 5869, BIP39, XChaCha draft)
- [x] 7 cargo-fuzz targets (CI runs 30 s each on nightly)
- [x] 200 MB file: encrypt+decrypt in 0.6 s with 8 MB peak working set (release, Windows)
- [x] CI green, merged (PR #3); CI fuzzing found the OPAQUE server-state rule (see decisions)

## Phase 2 (RN binding + app shell) — summary

- [x] Expo SDK 58 app in `app/` (`@circlo/app`, RN 0.88, expo-router, NativeWind 4.2 + Tailwind 3.4, brand tokens, dark mode)
- [x] Drawer (Profile, Circles, Devices, Settings, Recovery phrase, Log out) + 4 icon-only tabs + Home header + FABs + empty states
- [x] `@circlo/core` generated from `core/` by uniffi-bindgen-react-native 0.31 **jsi2** flavour (`app/modules/circlo-core`);
      app depends directly on `@ubjs/react-native`
- [x] Dev screen "Crypto self-test" (`circlo://dev`, dev builds only)
- [x] typecheck, lint, 9 jest tests pass
- [x] **Android emulator (API 36.1, x86_64): all self-tests PASS** — blob tamper rejected, circle 7 reads 7/9 not 5
      (payload 160 B), recovery phrase, OPAQUE register+login (Argon2id 64 MiB, ~0.5 s debug), 5 MB stream
- [x] **200 MB file streamed on the emulator: PASS, app memory flat (PSS 409 MB before, 408 MB peak during)**; 43 s in
      a debug (unoptimised) Rust build
- [ ] iPhone via EAS dev build (needs owner: Expo account + Apple developer account; see "Waiting on owner")
- [x] CI green, merged (PR #4)

## Phase 3 (server foundations) — summary

- [x] Spring Boot 4.1.2 (decided: 3.5 OSS support over; Boot 4 modules adopted)
- [x] Rust core over JNI (`core/src/jni_bridge.rs`, feature `jni`; test client feature `jni-test-client`); Java facade `CircloCore`
- [x] Flyway V1: all PLAN.md tables, adjusted per CRYPTO.md §14 (opaque_record, handle_lookup, recovery_pubkey, profile blob)
      + opaque_login_states, recovery_challenges, refresh_tokens
- [x] Endpoints: register start/finish, login start/finish (OPAQUE), refresh (rotating), recovery start/finish,
      password start/finish, backups get/put, devices, identity get/put (docs/api/openapi.yaml)
- [x] JWT (HS256, iss circlo-server, aud circlo-app, scopes full|recovery), refresh tokens stored as hashes
- [x] Rate limits: 30 auth requests/min per client address (hashed in memory), 10 login/recovery attempts/min per handle
- [x] No request-body/IP logging (no access log; error bodies are fixed codes) — `NoPayloadLoggingIT` asserts logs during
      real traffic contain no handles, passwords, tokens, keys, user ids or IPs
- [x] 26 server tests pass locally against circlo_test + circlo-media-test; local server smoke-tested against `circlo`
- [x] CI green, merged (PR #5; CI caught Flyway logging the JDBC URL — silenced)

## Phase 4 (app onboarding) — summary

- [x] Signup: handle + password → OPAQUE → keys + 24-word phrase → confirm 3 words → keys and both encrypted backups uploaded
- [x] Login on a new device: OPAQUE → download + decrypt password backup on the device → rebuild identity locally
      (`identity_from_secrets`) and **refuse if it doesn't match the published keys** → register this device
- [x] Recovery: 24 words → signed challenge → decrypt recovery backup → new password (other sessions revoked)
- [x] Keys in Android Keystore / iOS Keychain via expo-secure-store (`com.circlo.app.keys`, this device only, excluded from backups)
- [x] Navigation resets on sign-in/out (finished onboarding screens incl. the phrase can't be revisited)
- [x] Screenshots/recordings blocked on the three recovery-word screens (expo-screen-capture; verified: capture is all black)
- [x] Abandoned signup no longer blocks the handle (found by the owner); 30 minutes to finish
- [x] **Emulator check: signup as demo_alice, log out, log in again → identical identity fingerprint
      (18ba 3d73 6df8 d6d9 2bdf 00b5 d4e5 9801); Devices lists both devices**
- [x] app typecheck/lint/15 tests; server 27 tests
- [x] CI green, merged (PR #6); iPhone check still pending accounts

## Phase 5 (friends) — summary

- [x] Server: invites (hash only, single use, 7 days), opt-in handle search, requests (only after redeeming the target's
      invite or if the target is discoverable), accept/decline, 160-byte payload relay, encrypted profile + address
      book blobs (versioned), V2 migration (invites.redeemed_by); `SocialFlowIT` 4 tests
- [x] App: invite QR + link (fingerprint in the URL fragment), paste/scan to redeem with fingerprint + signature check,
      Notifications with Accept/Decline, friends list, friend profile, safety number (60 digits + QR, scan to verify),
      identity-change warning, Edit profile (encrypted), Settings: "Let people find me" (off by default)
- [x] **Emulator end to end (demo_alice + demo_bob):** Alice set an encrypted profile and made an invite; Bob signed up,
      pasted the link (keys checked against the fingerprint) and sent a request; Alice saw "Bob Demo · @demo_bob wants
      to be friends" decrypted on her phone and accepted; each sees the other's decrypted name and bio;
      **safety numbers identical on both sides** (18662 41244 68215 34172 46366 84690 87695 03189 65010 09040 41676 91708)
- [x] **DB dump after the test: no display names, bios, handles or passwords, as text or hex** (profiles, address books,
      payloads all ciphertext)
- [x] THREAT_MODEL.md: comparison with Threema; CRYPTO.md v1.1 (epoch secrets in the address book)
- [x] CI green, merged (PR #7)

## Phase 6 (circles) — summary

- [x] Server: batch payload re-wrap (`PUT /v1/friend-payloads/batch`, all-or-nothing, ≤500; accepted friends + my pending
      requests), unfriend (`DELETE /v1/friends/{id}` removes friendship + all payloads both ways); `CircleRotationIT`
- [x] App: Circles screen (defaults 1 Me only … 10 Faded contacts, custom 11–100, member + audience counts), circle
      detail (rename, add/remove), friend profile "In circle" (author-only) + Move + Unfriend
- [x] Every placement change and unfriend rotates the epoch (CRYPTO.md 8.4): new epoch saved to the encrypted address
      book first, registered, re-wrapped for everyone at their circle, profile re-encrypted; resumable with retry
- [x] **Emulator: Alice moved Bob 100 → 7.** Server before: Alice 1 epoch, 1 payload → Bob. After: Alice 2 epochs
      (1 active), 2 payloads → Bob, all 160 bytes. Bob still decrypts Alice's (re-encrypted) profile; Bob sees nothing
      about Alice's circles
- [x] Crypto-level circle semantics already proven in `core/tests/flows.rs` (circle 7 reads 7 and 9 not 5; 7 → 9 closes
      new circle-7 posts). **Re-verify on the emulator with real posts in Phase 7.**
- [x] app 23 tests, server 33 tests
- [x] CI green, merged (PR #8)

## Phase 7 (posts and media) — summary

- [x] Server: size-locked upload slots (`POST /v1/media/uploads`, random 64-hex object keys, PUT locked to the padded
      ciphertext size), posts with encrypted header + per-post key ref (`POST /v1/posts`; epoch must be mine, media
      owned, unattached, < 23 h old and present at the declared size), friend-only reads and 5-min download URLs,
      delete; `MediaSweeper` removes deleted posts' media and uploads unattached after 24 h; V3/V4 migrations;
      `PostsFlowIT` 4 tests, `PresignedUploadIT`
- [x] Core: `PlaybackSession` loopback server for progressive video (127.0.0.1 only, 256-bit token per video,
      plaintext only in memory one chunk at a time; downloader follows what the player needs next); 3 tests incl.
      out-of-order download and tamper rejection
- [x] App: compose sheet (audience chip + bottom sheet with live "visible to this circle and closer · N people",
      remembers last circle, starts at "Me only"; counter ring; up to 4 photos or 1 video; remove/reorder),
      background outbox with inline "Encrypting and uploading… N%" card and retry, basic Home feed with media grid,
      decrypted-image cache, inline progressive video, author-only audience badge, delete
- [x] Metadata: JPEG re-encode + APP1/APP13/COM removal; MP4 `udta`/`meta` zero-filled (tested on a real ffmpeg file
      with a GPS location tag: location and device tags gone, video still decodes); picker copies deleted after
      posting/cancel; all media caches wiped at sign-out
- [x] **Emulator (demo_bob → demo_alice):** Bob posted 2 photos to circle 7 (Alice is in his circle 7) and a 10 MB,
      20 s video to circle 5. Upload progress card shown; feed showed decrypted thumbnails and poster.
      **Video played progressively** (ExoPlayer PLAYING at 2.9 s with 14.9 s of 20 s buffered; only the
      10,488,340-byte ciphertext on disk). **Alice sees the circle-7 post and not the circle-5 video**, and no audience
      label. Decrypted cache files: no EXIF/GPS/camera tags, 480 px thumbnails
- [x] **Bucket: 5 objects, all random 64-hex keys; no JPEG/JFIF/Exif/ftyp markers or post text in the raw data.**
      DB: headers are ciphertext (no text/mime hits), `posts` has no circle column
- [x] Bug found and fixed on the way: readers didn't fetch an author's new epoch keys after a rotation; the feed now
      refreshes a contact's payloads when it meets an unknown epoch
- [x] app 35 tests, core 62, server 37
- [x] CI green, merged (PR #9)

## Phase 8 (timeline, threads, replies, likes, profiles) — summary

- [x] Server: `ThreadController` (encrypted replies ≤ 8 KiB, delete by reply or post author, idempotent likes, likers),
      counts on `PostView` (`replyCount`, `likeCount`, `likedByMe`), one-call `GET /v1/feed` (me + accepted friends,
      newest first, cursor paging), V5 index on `friendships(user_b, status)`; `ThreadFlowIT` 4 tests incl. perf
- [x] Core: `ReaderKeyring::for_circle(epoch_root, circle)`; flow test proves "Preview as" opens exactly what the
      friend's own keyring opens, circles 1–100
- [x] App: FlashList timeline with paging, pull-to-refresh, "N new posts" pill (background check each minute), header
      hides on scroll; post card with links, Reply/Like counts, overflow (Delete own / local Mute); thread view with
      docked reply composer, "Liked by…" (names only for people I know); full-screen viewer (swipe, pinch, double-tap,
      swipe down); Profile with banner, bio, friend count, Posts | Media | Likes (own only); friend profiles with
      posts and "Preview as…"
- [x] Images decrypt in memory (core chunk decryptor) — no plaintext image files; thumbnails/posters cached on disk
      sealed with a per-device `local_cache_key` (CRYPTO.md §10, in the keystore, never backed up); batched
      download URLs; per-epoch `placements` recorded so Preview-as uses the exact circle per epoch
- [x] **Emulator (demo_alice / demo_bob):** Alice liked and replied to Bob's circle-7 post; Bob's thread shows
      "Liked by Alice Demo" and her decrypted reply. Alice posted to circle 7 and circle 2; **Preview as Bob showed only
      the circle-7 post, and Bob's own login showed exactly the same** (not the Spouse or Me-only posts, no labels)
- [x] **Perf:** server `GET /v1/feed` for 500 posts across 50 friends: first page of 50 in 29 ms, all 500 in 214 ms
      (`ThreadFlowIT`). Client: opening 500 posts from 50 friends (incl. 200 trial decryptions that fail) 1,014 ms on
      the emulator with the *debug* core build. First screen (50 posts) ≈ 130 ms
- [x] Bugs found and fixed: React Compiler memoized module-level store reads (feed now reads only through
      `useSyncExternalStore` snapshots); Drawer back went to Home instead of the previous screen (`backBehavior="history"`)
- [x] app 45 tests, core 62, server 41
- [x] CI green, merged (PR #10)

## Phase 9 (messaging, MLS) — summary

- [x] Core: `mls.rs` on OpenMLS 0.9 (RFC 9420, ciphersuite 0x0003). One MLS client per device; Basic credential
      `user_id || device_id || binding` where the identity key signs the device's MLS key (CRYPTO.md 13a); key
      packages incl. last resort; create/add/remove/merge/clear; join from Welcome; Padmé-padded CBOR chat payload;
      state exported and sealed with the device's `local_cache_key`. 5 tests (3 people on 4 devices, removal,
      restore, payload, garbage)
- [x] Server: MLS delivery service (`MessagingController`, V6): device-scoped key packages with friend-only claims,
      groups with a device ACL, one ordered log per group (commits must target the current epoch — first wins,
      loser gets 409), welcomes per added device, 30-day retention; reads only clear MLS framing via JNI
      `mlsMessageMeta`. `MessagingFlowIT` drives real MLS clients through the real endpoints
- [x] **Done-criteria (MessagingFlowIT):** a 3-person group works; Alice's second device receives everything;
      **a removed member can't fetch (404) and can't decrypt new messages** even with the bytes; a stale commit is
      rejected; strangers can't claim key packages or be added
- [x] App: Messages inbox (unread counts kept on device), new chat / add people picker (friends only), chat screen
      (bubbles, date separators, composer, members sheet with add/remove, delete-for-me), members' credential
      bindings verified against pinned identity keys (sending blocked if one fails), local history sealed on device
- [x] **Emulator, two separate devices (Circlo_Phone_2 = demo_alice, Circlo_Phone_3 = demo_bob):** Alice started a
      chat, Bob's device joined from the Welcome, messages went both ways and decrypted on each phone. DB: 3 MLS
      messages, 0 plaintext hits; two texts of different lengths both stored as 446 bytes (padding)
- [x] app 48 tests, core 66, server 43
- [x] Carry-overs (attachments, new devices joining chats, revoke on sign-out) done in Phase 10
- [x] CI green, merged (PR #11)

## Phase 10 (multi-device, push, and Phase 9 carry-overs) — summary

- [x] Device linking by QR (CRYPTO.md 13b): new phone shows a QR (`circlo://link/<id>#<key>`) and a 6-digit code;
      the signed-in phone checks the code, seals the account secrets to that key (HPKE), and the server relays them
      once (10 min, single use, rate-limited pickup with a session). Core `link.rs` with tests (round trip, bound to
      link id + user, wrong key/tamper fail, code stability)
- [x] Revoke devices (Devices screen, and automatically on sign-out): removed from chats' server ACL, key packages,
      welcomes and push token deleted
- [x] Carry-over: a member's new device is added to existing chats by any member (`missing-devices` + claim by
      device id), throttled to every 5 min per chat
- [x] Carry-over: chat attachments — same strip/encrypt/upload pipeline as posts, objects attached to the group
      (members-only download URLs, 30-day retention, never swept as unattached), keys and object keys inside MLS
- [x] Push: content-free `{"type":"activity"}` + a fixed generic notification; recipients only (chat messages to
      other members' devices, replies/likes to the author, friend requests); tokens sealed with
      CIRCLO_PUSH_TOKEN_KEY; FCM HTTP v1 sender when configured. App registers via expo-notifications and syncs on
      a push. **DevicesFlowIT captures the push: only the recipient's token, data exactly `{"type":"activity"}`, no
      names, ids or content**
- [x] **Emulator:** Alice → Bob photo in a chat (decrypted on Bob's phone); Bob's phone linked a fresh phone by QR
      (codes matched on both screens) → it signed in as Bob without a password; Bob's two phones both got the new
      chat and message ("You: …" on the other device)
- [x] Bugs found and fixed: access tokens (15 min) were never renewed while the app stayed open — the API client
      now refreshes once (single flight, so a rotating refresh token is never reused) and retries; `onResponse`
      must return `undefined` for unchanged responses; MLS state now kept per device id and discarded if it can't
      be opened (re-install); scanned link codes passed in memory (a `#` in a route param was dropped)
- [x] app 50 tests, core 68, server 47
- [x] CI green, merged (PR #12)

## Phase 11 (safety, abuse, legal) — summary

- [x] **Read token** (owner-approved, CRYPTO.md 13c): `read_token = HKDF(post_key, "circlo/v1/read-token")`; the
      post stores only its labelled SHA-256 hash; listing/adding replies and likes, likers and counts all need the
      token (`X-Circlo-Read-Token`, constant-time compare). Counts moved out of the feed into `POST /v1/posts/stats`.
      Friends outside a post's circle can no longer see who interacted. THREAT_MODEL leak 14 closed
- [x] ~~Reports to the operator~~: built (HPKE-sealed to a moderation key, offline CLI), checked on the emulator,
      then **removed by owner decision** — posts are shared between people who know each other, who can ask each
      other to remove things. V10 drops the `reports` table. App store review may still ask for reporting (LEGAL.md)
- [x] **Block**: unfriends first (rotates my epoch), then a server-side block that refuses friend requests, invite
      redemption and chat adds both ways; unblock in Settings. Mute stays local
- [x] **Account deletion** (retype handle): S3 objects first, then the user; every row cascades (V9 added the
      missing posts→epochs cascade). SafetyFlowIT checks no table still holds the user id
- [x] **Data export**: decrypted on the device (profile, friends as I named them, circle labels, my posts with
      photos as data URIs, chats) to one JSON file in a folder the user picks. Nothing goes to the server
- [x] Settings screen: discoverable, blocked people, export, delete account; reusable ActionSheet (Android alerts
      allow only three buttons)
- [x] Legal: docs/LEGAL.md lists the questions for counsel (platform liability for content we can't see, CSAM
      reporting duties, lawful access requests, GDPR roles and data export/erasure, app store rules for user content,
      AGPL obligations). **Needs a lawyer before launch**
- [x] app 50 tests, core 69, server 50

## Phase 12 (hardening) — summary

See docs/HARDENING.md for how to repeat each check.

- [x] **Certificate pinning** in release builds (Android pin-set, iOS NSPinnedDomains). The host comes from
      `EXPO_PUBLIC_API_URL` and the pins from `CIRCLO_PIN_SHA256` (EAS env), so no production hostname or key is in
      git. A production build fails without a live pin and a backup pin. Tested: config generation and validation
- [x] **Rooted/jailbroken warning**: checked once per launch; dismissible Home banner plus a permanent note in
      Settings. Warns only, never blocks
- [x] **Reproducible builds**: server jar byte-identical across clean builds (fixed outputTimestamp; checked
      locally and in CI); Rust release library checked in CI from two source paths
      (`core/scripts/check-reproducible.sh`)
- [x] **Optimised app core**: Cargo profile `app` (release, panic=unwind so a Rust bug becomes a JS error),
      `make core-android-release`. Android library is now 4.5 MB, down from 75 MB
- [x] **Dependency audit**:
      - new CI workflow `deps-audit`: osv-scanner over the Rust, npm and Maven dependencies, plus cargo-deny for
        advisories, AGPL-compatible licences and crates.io-only sources; runs on lockfile changes and weekly;
      - `npm audit fix` updated node-forge;
      - the remaining zod 3 advisory is in Expo's build-time command-line tool only (not in the app), accepted until
        2027-01-31 in `osv-scanner.toml`;
      - the first CI run found 6 Rust advisories. None is reachable or exploitable in Circlo, so each is accepted until
        2027-01-31 with its reason in `osv-scanner.toml` and `core/deny.toml`:
        - crypto-bigint timing: only in P-256 code, and Circlo uses X25519/Ed25519 only;
        - block-buffer: needs a hash function to panic;
        - libcrux-kem and basic-toml: in Cargo.lock but never compiled;
        - proc-macro-error2: build-time only.

        The crypto-bigint and block-buffer fixes need upstream releases (OpenMLS, opaque-ke)
- [x] **Leaked-database drill** (`infra/leak-drill.sh` + scanner): dev DB (125 KB dump) and all 11 bucket objects
      plus the server log scanned for 13 markers typed on the emulators (handles, names, post text, EXIF test tags),
      image/video signatures, emails and IPs, and low-entropy objects: **PASS, nothing readable**. The scanner's own
      tests prove each kind of leak is caught (run in CI)
- [x] **Load test** (`LoadIT`, on request, 64 clients, 30 s, real OPAQUE logins). It found two N+1 query patterns
      (feed media, batch stats) and an undersized connection pool. Fixed:

      | | Before | After |
      |---|---|---|
      | Throughput | 106 req/s | 919 req/s |
      | Feed p95 | 963 ms | 156 ms |
      | Stats p95 | 3.5 s | 204 ms |
      | Errors | 0 | 0 |

      The pool size is set by `CIRCLO_DB_POOL_SIZE` (default 24)

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-10-25 | **Windows-native dev**, repo at `C:\Users\zaheer\code\circlo`; WSL only for DB + MinIO. CLAUDE.md updated | Owner decision |
| 2026-10-25 | License **AGPL-3.0** | Owner decision (open decision 3) |
| 2026-10-25 | Server secrets in `server/.env` (not `.env.local`), imported via `spring.config.import=optional:file:./.env[.properties]` in profiles `local` and `test` | Owner created `server/.env`; it's git-ignored |
| 2026-10-25 | Target **MariaDB 11.8** with `mariadb-java-client` + `flyway-mysql`; CI uses a `mariadb:11.8` service container | Existing DB is MariaDB; CI matches it. Local dev never uses a DB container |
| 2026-10-25 | MinIO image `cgr.dev/chainguard/minio` (local compose and CI); bucket/user init via the bundled `mc` from dev-up.sh; dropped the `circlo-minio-init` container | `minio/minio` and `minio/mc` are no longer on Docker Hub; Chainguard image has no shell |
| 2026-10-25 | `dev-up.sh` reuses an existing MinIO container if `MINIO_CONTAINER` is set | Owner already runs one on 9000 |
| 2026-10-25 | `infra/dev-up.ps1` (Windows entry point) keeps WSL awake with a hidden `sleep infinity` | WSL idle shutdown stopped MinIO mid-test |
| 2026-10-25 | Spring Boot **3.5.16** (latest 3.x) for now | PLAN.md says Boot 3; asked owner about 4.x (Flyway also warns MariaDB 11.8 is newer than it supports) |
| 2026-10-25 | Data access via `spring-boot-starter-jdbc` (no JPA) | Rows are mostly opaque blobs; plain SQL keeps it obvious what's stored |
| 2026-10-25 | CI gitleaks runs the release binary directly | No license key or third-party action needed |
| 2026-10-25 | gitleaks allow-list includes exact `circlo/v1/...` label strings | They're public KDF labels; gitleaks flagged `"circlo/v1/reply"` as an API key |
| 2026-10-25 | Owner delegated crypto choices ("best possible security, no PII on server, DB theft reveals nothing") → adopted A1–A11 in CRYPTO.md §14 | Owner instruction |
| 2026-10-25 | **OPAQUE (RFC 9807)** replaces Argon2id+Ed25519 challenge login; `ServerSetup` lives in `CIRCLO_OPAQUE_SERVER_SETUP`, not the DB | Original design let a DB thief guess passwords offline and open password backups |
| 2026-10-25 | Handle required (login name), stored only as `HMAC(CIRCLO_HANDLE_KEY, handle)`; not searchable unless the user opts in | No plaintext handles in the DB; resolves open decision 1 |
| 2026-10-25 | Every circle change rotates the epoch; profile key is per epoch | Single inward-move payloads would reveal who moved; ex-friends must lose future profile access |
| 2026-10-25 | Backup plaintext is a fixed binary layout, not CBOR | All-secret payload: fully zeroizable, no parser |
| 2026-10-25 | Core crypto crates pinned to one RustCrypto generation (digest 0.10/rand_core 0.6), matching opaque-ke 4; hpke 0.13 (not 0.15, published the same day) | Consistency, audited versions, avoid brand-new releases |
| 2026-10-25 | uniffi 0.31 (matches uniffi-bindgen-react-native 0.31) | Phase 2 binding generator compatibility |
| 2026-10-25 | Server will call circlo-core via JNI for OPAQUE/HMAC/push-token sealing (Phase 3) | "All crypto lives in /core"; no trustworthy Java OPAQUE |
| 2026-10-25 | OPAQUE server login state stays server-side only (Phase 3: short-lived row/cache, single use) | CI fuzzing showed that whoever supplies the state can complete a login; fuzz target now uses a genuine state |
| 2026-10-26 | Expo SDK 58 / RN 0.88 / NativeWind 4.2.7 with Tailwind 3.4.19 | Latest stable; NativeWind 4 requires Tailwind 3 |
| 2026-10-26 | Core bound with ubrn **jsi2** (shared `@ubjs/react-native` player, no per-library C++) | Simplest native build, especially on Windows |
| 2026-10-26 | Generated TS bindings committed; built `.so`/xcframework not (regenerate with `make core-android`) | CI typechecks without Rust; binaries are 20 MB+ debug |
| 2026-10-26 | Colour tokens in `app/src/theme/tokens.js`, shared by Tailwind and `usePalette()` | One source of truth for classes and navigation options |
| 2026-10-26 | Full drawer navigator not rendered in jest (Reanimated 4.7 native init fails under jest-expo); screens/config tested directly, navigation checked on emulator | Upstream incompatibility; avoid fragile hand-written Reanimated mocks |
| 2026-10-26 | Android build pins CMake 4.1.2 via config plugin; Windows LongPathsEnabled=1 | RN codegen object paths exceed 260 chars; ninja ≥1.12 needed |
| 2026-10-26 | **Spring Boot 4.1.2** (owner delegated technical choices) | Boot 3.5 OSS support ended; Flyway in 3.5 warned on MariaDB 11.8 |
| 2026-10-26 | Server crypto via JNI into circlo-core (`jni` 0.21 API), built with profile `server` (panic=unwind) | All crypto in core; a Rust panic becomes a Java exception instead of killing the JVM |
| 2026-10-26 | Client-side JNI functions only behind `jni-test-client` | Integration tests act as a real app; production server lib excludes them |
| 2026-10-26 | Server-assigned user id at register/start (pending row, 10 min) | Identity signature and backup AAD bind the user id before registration finishes |
| 2026-10-26 | Unknown handles: fake OPAQUE response (opaque-ke) and stable fake user id for recovery | No account enumeration |
| 2026-10-26 | Local-dev server secrets generated into git-ignored server/.env by GenerateSecrets | Needed to run the server locally; production uses the secret store |
| 2026-10-26 | API client generated from docs/api/openapi.yaml with openapi-typescript (run via pinned npx; peer-dep on TS 5) + openapi-fetch | One contract for server and app |
| 2026-10-26 | Access tokens in memory only; refresh token + keys in SecureStore (WHEN_UNLOCKED_THIS_DEVICE_ONLY) | Keys never migrate via OS backups; new devices log in or link |
| 2026-10-26 | Unfinished signups are replaced by a new register/start (only active accounts block a handle) | Owner hit a dead end after abandoning signup; a pending row holds no keys |
| 2026-10-26 | Dev builds allow cleartext HTTP (APP_VARIANT != production); release builds HTTPS only | Local server on the LAN/emulator |
| 2026-10-26 | New friends start in circle 100 (widest) until the author places them (Phase 6 UI) | A circle key must be sent at request/accept time; widest is the safe default |
| 2026-10-26 | Friend requests need a redeemed invite from the target, or a discoverable target | Stops strangers from spamming requests |
| 2026-10-26 | Profiles readable by connected users in any non-blocked state (incl. incoming requests) | So you can see who is asking before accepting; still ciphertext to the server |
| 2026-10-26 | Progressive video via a loopback HTTP server in the core (`core/src/playback.rs`), fed ciphertext pieces by the app | Platform players can't read STREAM; keeps all decryption in the core and never writes plaintext video to disk |
| 2026-10-26 | Metadata stripping is byte-level in TS (`strip-metadata.ts`): JPEG APP1/APP13/COM removed after re-encode; MP4 `udta`/`meta` renamed to `free` and zero-filled | No ffmpeg on device; renaming alone would leave location bytes readable by friends |
| 2026-10-26 | A post's circle is stored only in my encrypted address book (`postCircles`); composer default is the last circle, else "Me only" | The header must not reveal the audience; nothing is shared by accident |
| 2026-10-26 | Media of deleted posts and uploads unattached after 24 h are swept from the bucket; posts may attach uploads < 23 h old | No ciphertext retained without a reason; no sweep/attach race |
| 2026-10-27 | One `GET /v1/feed` (me + friends, newest first) instead of 50 per-friend calls | Same headers and metadata as per-author fetches; meets the 2 s budget |
| 2026-10-27 | Images decrypted in memory to data URIs; thumbnails sealed on disk with a per-device local_cache_key | No plaintext images on disk (PLAN.md Phase 8 "encrypted local storage") |
| 2026-10-27 | Mute is local (address book); Block/Report wait for Phase 11; Share-to-DM waits for Phase 9 | Don't ship dead buttons; mute needs no server state |
| 2026-10-27 | Reply/like visibility = any friend of the author (spec: plain likes); read-token fix proposed, not built | Changing it needs a new key derivation → owner decision |
| 2026-10-27 | MLS via OpenMLS 0.9 with our own exportable storage provider, state sealed with local_cache_key | All MLS crypto in the core; state never leaves the device |
| 2026-10-27 | Calling device named by `X-Circlo-Device` header and checked against my devices (tokens have no device claim) | Smallest change to auth; a user can only act as their own devices |
| 2026-10-27 | Server orders commits by epoch from the clear MLS framing (first wins, 409 for the loser) | Prevents forks without reading content |
| 2026-10-27 | gitleaks allowlist moved to `[[allowlists]]`; crate name `libcrux-secrets` allowed only in Cargo.lock | False positive from OpenMLS's dependency list; every rule still applies elsewhere |
| 2026-10-27 | **Owner approved** the per-post read token (`circlo/v1/read-token`) so only a post's audience can see/add replies and likes; built in Phase 11 | Closes THREAT_MODEL leak 14 |
| 2026-10-27 | Device linking: HPKE base to a QR key + 6-digit confirmation code; single-use 10-min server hand-off with a session | Encrypted transfer; resists scanning an attacker's code |
| 2026-10-27 | Pushes: `{"type":"activity"}` plus a fixed generic notification text; tokens sealed with CIRCLO_PUSH_TOKEN_KEY | No content, names or counts ever leave the server in a push |
| 2026-10-27 | **Owner removed reporting to the operator** (built, then removed before merge); block + mute only | Posts are between acquaintances; nothing should ever become readable by the operator |
| 2026-10-27 | Pinning: leaf SPKI pins (live + offline backup) from EAS env; production builds fail without them; only the API host is pinned | No hostnames in a public repo; backup key avoids lock-out; media is E2EE and AEAD-checked |
| 2026-10-27 | Rooted/jailbroken: warn only (expo-device check) | PLAN.md says warn; the check is heuristic and blocking hurts honest users |
| 2026-10-27 | App core built with Cargo profile `app` (panic=unwind) instead of `release` (abort) | uniffi turns a panic into a JS error instead of killing the app |
| 2026-10-27 | osv-scanner + cargo-deny in CI instead of local tools; accepted findings need a reason and expiry | One scanner for all three ecosystems; accepted risk is revisited |
| 2026-10-27 | **No tracking** (owner rule): no IP/email/phone/location/device/last-seen data anywhere; install-referrer and ad-id permissions stripped; iOS privacy manifest declares no tracking; schema test blocks tracking columns; docs/PRIVACY.md lists everything stored | Only what users post for others is kept, and only as ciphertext |
| 2026-10-28 | **Renamed Halqo → Circlo** everywhere: packages (`circlo-core`, `@circlo/core`, `com.circlo.*`), DBs `circlo`/`circlo_test`, buckets `circlo-media(-test)`, `CIRCLO_*` env, `circlo://` scheme, crypto labels `circlo/v1/...` (test vectors regenerated; 16-byte MLS state label is now `circlo-mlsstate1`) | Owner decision. Changed labels and OPAQUE server id make existing dev accounts and ciphertext unreadable: re-register on dev. V1 migration comments changed, so existing DBs need a Flyway checksum repair |
| 2026-10-28 | **No handle search** (owner decision): `/v1/users/search`, `/v1/me/discoverable` and `users.discoverable` removed (V11); friend requests need a redeemed invite from the target; the Search tab is now Friends | Invite link or QR is the only way to connect: nobody can probe whether a handle exists or spam requests |
| 2026-10-28 | **Security hardening** after a library audit: MLS credential bindings use strict Ed25519; the loopback video server parses requests with `httparse` (+ fuzz target); rate limits use Bucket4j + Caffeine with the client IP from Tomcat's RemoteIpValve, trusted only for `CIRCLO_TRUSTED_PROXIES`; reusing a rotated refresh token revokes all of the user's sessions (RFC 9700) | Replace hand-written security code with standard libraries; the shared multi-instance limit belongs at the edge (HARDENING.md). Rate-limit keys stay in memory only (no-tracking rule) |
| 2026-10-28 | **Brand: Halo mark, Tailwind sky primary** (owner): icons, adaptive/themed icon, iOS dark/tinted icons, notification icon and splash from `circlo-brand-assets`; in-app mark drawn from the pack's SVG geometry. Primary is sky-600 on light / sky-400 on dark, with an `on-primary` token (white / sky-950) for text on primary; splash is white on light, ink on dark | Teal looked off. White text on sky-500 is only 2.8:1 and on sky-400 2.1:1, so light uses sky-600 (4.1:1) and dark puts dark text on sky-400 |
| 2026-10-29 | **Brand: wordmark with dotted "o"** (owner) replaces the Halo mark: icons, adaptive/themed icon, iOS dark/tinted icons, notification icon and wordmark splash from the `circlo-wordmark-assets` pack (kept in `circlo-brand-assets/`); icons and splash are white (gray-950 in dark), never sky; in-app `CircloWordmark` / `CircloSymbol` drawn from the pack's SVG geometry | Owner decision. Brand tokens: ink `#101828`, accent sky-500 / sky-400, background `#FFFFFF` / `#030712` |
| 2026-10-29 | **Reporting posts is back** (owner; reverses 2026-10-27; CRYPTO.md v1.4, 13c) | Needed for safety and app review. The reporter's phone seals the post as they see it (text, photos, author, reason, note) to the operator's moderation key, signed by the reporter, with the report id bound into the AAD; the server stores ciphertext only (V14 `reports`, 20/hour), the operator opens reports offline (`circlo-moderation`). Report shows only when the server has `CIRCLO_MODERATION_PUBLIC_KEY`. Messages and profiles can't be reported yet |
| 2026-10-29 | **App store safety features** (owner): block restored (post menu, profile sheet, chat long-press, and after any report; blocked list in Settings); report a person (profile) or one chat message, same sealed format as posts; terms and privacy agreement required at signup; Settings links to Terms, Privacy, Child safety standards and Support on www.hellocirclo.com | Apple guideline 1.2 and Google Play's UGC policy require report, block and agreed terms. Blocking removes the friendship (keys rotate) and the server refuses requests, invites and new chats both ways; in chats that already exist, a blocked person's messages are hidden on my devices and no longer push to me (server skips pushes to blockers). Mute stays removed |
| 2026-10-28 | **Circles reshaped + Close Friends** (owner): Only me is level 0; defaults My person / Kids / Parents & siblings / Friends / Everyone at chain positions 20/40/60/80/100 (gaps for circles added later), new friends default to Friends; **Close Friends** is an exclusive circle off the chain (CRYPTO.md v1.2, 8.5): key `X1 = HKDF(C1, "circlo/v1/exclusive-circle/1")`, carried in friend payload v2 (192 bytes; random filler for non-members), V12 widens the column; old books migrate once and rotate | Exclusive audience without revealing membership to the server or other friends; closer chain circles grant nothing. Membership changes rotate the epoch like any circle change. One exclusive slot per payload for now |
| 2026-10-29 | Moving someone closer does **not** open earlier posts | Past posts keep the audience they were shared with; only new posts follow the new circle (mirrors: moving someone out can't revoke what they saw) |
| 2026-10-29 | **Independent circles, multi-select audiences** (owner; CRYPTO.md v1.3) | Nested circles confused people ("Kids" also reached "My person"). Now: Only me and Everyone are built in; up to 8 circles of my own (starters Close Friends, Family, Kids, Work; rename, delete, add); a friend can be in any number; a post goes to Only me, Everyone, or any set of circles, and a circle's posts reach its members only. Friend payload v3 (416 bytes, 8 circle slots; v1/v2 still open, V13 widens the column); posts carry 8 shuffled key slots so every audience looks the same to the server. One-time migration per address book: My person → Close Friends + Family, Kids → Kids, Parents & siblings → Family, Close Friends members stay, Friends/Everyone → no circle; then a rotation. Composer defaults to the last audience (Only me before the first post) |
| 2026-10-27 | **UI identical on iOS and Android, X/Bluesky style**: bundled Inter font, own header/tab bar/dialogs/toggle/spinner instead of native ones; teal brand kept | Owner request; native headers, alerts and switches looked like stock Material on Android. Fonts ship in the app (no runtime download, no third-party requests) |
| 2026-10-25 | Only `secret-scan / gitleaks` should be a required check | Path-filtered CI workflows don't run on every PR |
| 2026-10-30 | **Compose is two steps**: write, then choose who can see it, with nothing pre-selected (the remembered last audience is no longer used). PLAN.md 2A updated | Owner decision: the audience must be a deliberate choice on every post |
| 2026-10-30 | **Login hardening**: passwords need 12+ characters, zxcvbn score 3+ and not in a leaked list (zxcvbn's ~49k + NCSC top 100k); 3 wrong passwords lock password login for 15 min, 1 h, then 24 h (escalating, not until recovery, so a handle can't be used to force someone through recovery); new sign-ins alert other devices; change-password screen | Owner request; lockout style chosen by owner |
| 2026-10-30 | **No remote push.** FCM removed (server sender, push-token endpoint and columns, CIRCLO_PUSH_TOKEN_KEY/CIRCLO_FCM_*); no APNs. Notifications tab lists requests, replies, likes and sign-ins (`GET /v1/activity`); opt-in background checks (expo-background-task) with a per-device counts-only check token (`GET /v1/activity/pending`) and local notifications | Owner decision: Apple and Google must not learn about users' activity; slower notifications accepted |
| 2026-10-31 | **iOS bundle ID `com.hellocirclo.app`** (Android stays `com.circlo.app`) | `com.circlo.app` was not available to register at Apple; the App Store Connect app uses `com.hellocirclo.app` |
| 2026-10-31 | **Root stack + drawer around the tabs only**; no docked "Post your reply" bar | On iOS the left-edge swipe opened the drawer instead of going back (every screen was a drawer screen). Replying starts only from the reply button |
| 2026-11-01 | **No end-to-end encryption** (owner): content over TLS, stored as sent, server enforces access; Rust core, OPAQUE, MLS, recovery phrases/passkeys, device linking and safety numbers removed | Simple sign-up and recovery (nothing to lose), and a web app |
| 2026-11-01 | **Accounts: name, username, email, password**; email verified with a 6-digit code (15 min, 5 guesses, hashed) before the account exists; login by username or email; reset by emailed code; Argon2id hashes | Owner request. Unverified signups don't hold a username or email and are deleted after a day |
| 2026-11-01 | **Sign-up asks no name** (username, email, password only); the name is optional, set or cleared in Edit profile (V19: `users.name` nullable). Others see the username until a name is set | Owner request: fewer fields at sign-up |
| 2026-11-01 | **Web app is a centred 600px column** with side borders (`components/app-frame.tsx`, `web:`-only classes) | Owner request: full browser width looked odd; phone apps unchanged |
| 2026-11-01 | Login lock (3 failures → 15 min / 1 h / 24 h) kept, now keyed by account and counting real failures; a password reset lifts it | The server now sees wrong passwords; reset by email replaces "the recovery phrase always works" |
| 2026-11-01 | Circle posts reach the circle's members **as they were when posted**; Everyone = current friends; unfriend/block removes access to everything | Keeps "moving someone closer doesn't open earlier posts" (2026-10-29); revocation is now possible, so it's done |
| 2026-11-01 | Invite links are `https://www.hellocirclo.com/i/<token>` (no key fingerprint); the website forwards browsers to the web app | Nothing to verify without keys |
| 2026-11-01 | Chats stored on the server with per-person read state; a sender can delete a message for everyone | Same chats on every device and on the web |
| 2026-11-01 | Web app = Expo static web export at app.hellocirclo.com; session refresh token in localStorage there | One codebase; accepted XSS risk documented in THREAT_MODEL.md |
| 2026-11-01 | Still invite-only (no username search) | "Rest of the flow stays the same"; search can be added later if wanted |

## Waiting on owner

1. **iPhone build**: an Expo account (`npx eas-cli@latest login`) and an Apple Developer account, then
   `cd app && npx eas-cli@latest build --profile development --platform ios`. iOS has never been run.
2. **EAS builds need the Rust core**: add the Rust toolchain + cargo-ndk to the EAS build image (or a prebuilt
   library step) running `make core-android-release` / `core-ios`; built libraries are not in git.
3. **Push credentials**: FCM service account (CIRCLO_FCM_PROJECT_ID, CIRCLO_FCM_SERVICE_ACCOUNT in the server's secret
   store) and google-services.json / APNs key in EAS credentials. Without them pushes are off; everything else works.
4. **Certificate pins** for production: `CIRCLO_PIN_SHA256` (live key + offline backup key) and `EXPO_PUBLIC_API_URL`
   in EAS (docs/HARDENING.md).
5. Create the `circlo` MariaDB user (DEV_SETUP §3) and switch `server/.env` off `root`.
6. GitHub web settings (PLAN.md 0B step 5), incl. required check `secret-scan / gitleaks`.
7. **Legal review** of docs/LEGAL.md, including whether app stores require in-app reporting (removed by owner).
8. **External cryptography audit** of /core and docs/CRYPTO.md before any public launch.
9. Phone checks below.

## Needs manual check

- (Phase 12) Release build with pins on a physical phone: the app works against the real HTTPS host; with a wrong
  pin it refuses to connect (Android and iOS). Root warning shows on a rooted test phone and not on a normal one.

- (Phase 11) Physical phones: block someone (they can no longer send requests or see new posts), unblock in Settings;
  export my data to a folder and open the JSON; delete a throwaway account and confirm it can't log in.

- (Phase 10) With push credentials configured: a chat message to a locked phone shows only "Circlo · You have new
  activity"; opening the app shows the decrypted message. Link a second physical phone by QR (compare the 6-digit
  codes) and revoke it from Devices.

- (Phase 9) Two physical phones: start a chat, message both ways, add a third person, remove them, and confirm the
  removed person stops receiving. Log in on a second phone as the same user and check new chats arrive there too.

- (Phase 8) On a mid-range Android phone with a release build: Home with ~500 posts from ~50 friends shows the first
  screen in < 2 s and scrolls smoothly (60 fps); pinch-zoom and swipe-down in the viewer.

- (Phase 7) On a physical phone over Wi-Fi: post 4 photos and a phone-recorded video (moov usually at the end); the
  video should start within a few seconds and seek; a friend sees it, a friend outside the circle doesn't. Check that
  a photo taken with location on shows no location in any exported copy.

- (Phase 4) On a physical phone: sign up, write down the phrase, confirm; log out; log in → Profile fingerprint matches;
  Devices shows 2. Try "Forgot password?" with the 24 words → set a new password → old password no longer works.

- (Phase 2) On a physical Android phone and an iPhone dev build: open drawer → "Crypto self-test" → Run checks (all PASS)
  and "Stream 200 MB" (PASS, app stays responsive). Also toggle system dark mode and confirm colours switch.

- (Phase 0) MinIO console opens at `http://<LAN_IP>:9001` from a phone on the same Wi-Fi.
- (Phase 0) Presigned PUT from the phone: on Windows run `.\infra\dev-up.ps1`, start the server
  (`cd server; mvn spring-boot:run "-Dspring-boot.run.profiles=local"`), then on the phone (same Wi-Fi) open an HTTP
  client app (e.g. "HTTP Shortcuts" / "API Tester"): `POST http://<LAN_IP>:8080/dev/presign-put`, copy `putUrl`,
  send `PUT <putUrl>` with any small body → expect 200; open `getUrl` in the phone browser → same body.
  If it times out, add the firewall rules in DEV_SETUP §2.

## Known issues

- (Phase 7) File encryption runs synchronously on the JS thread (`Core.encryptFile`); large videos freeze the UI for a
  few seconds while the progress card shows. Move to an async/worker export in Phase 12 performance work.
- (Phase 7) The full timeline (FlashList, paging, "New posts" pill, thread view, media viewer) is Phase 8; Home is a
  basic list for now. The expo dev-menu gear overlaps the Post button in dev builds only.
- (Phase 7) Account deletion must also delete the user's bucket objects (media_uploads rows cascade with the user);
  handle when account deletion is built.

- WSL can shut down when the emulator cold-boots (Hyper-V); `infra/dev-up.ps1`'s hidden keep-alive did not survive
  in one session. Workaround: run `wsl -d Debian -- sleep infinity` in a terminal while developing. Symptom: server
  logs "Connection refused" to localhost:3306 and the app shows "Something went wrong".

- zod 3 advisory (GHSA-mrhx-c7xc-m3w5) in Expo's build-time CLI; accepted until 2027-01-31 (`osv-scanner.toml`).
- Dev builds still use the debug core (`make core-android`); use `make core-android-release` for performance checks and
  release builds. EAS builds need the Rust toolchain + cargo-ndk in the build image (or a prebuilt library step).

- Flyway (managed by Boot 3.5) logs "MariaDB 11.8 is newer than this version of Flyway". Works; resolved by a Flyway/Boot upgrade.
- First commit `12fbddb` is authored with a personal email and is already public (can't be undone; future commits
  can use the GitHub noreply address if the owner wants).
