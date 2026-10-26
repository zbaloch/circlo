# Halqo build progress

Memory file for Claude Code sessions. Read this first when resuming. Keep it accurate.

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
| 9 Messaging (MLS) | **Done (text) on Android** on `phase-9-messaging`; attachments carried to Phase 10 |
| 10–12 | Not started |

## Environment (as of 2026-10-25)

- **Windows is the main dev platform (owner decision).** Repo at `C:\Users\zaheer\code\halqo`; public GitHub repo
  `zbaloch/halqo`, default branch `main`.
- Windows tools: git, gh (logged in as `zbaloch`), Java 21, Maven 3.9.12, Node 24, Python 3.12, pre-commit 4.7
  (`python -m pre_commit`), Rust via rustup (`%USERPROFILE%\.cargo\bin`, not on Git Bash PATH by default) with
  cargo-ndk and Android targets, VS Build Tools 2022. No `make`.
- Debian WSL2 (mirrored networking): MariaDB 11.8.6 (bound to 127.0.0.1, reachable from Windows at localhost:3306),
  Docker 26.1 with the owner's MinIO container **`minio`** (`cgr.dev/chainguard/minio`), reached at `http://<LAN_IP>:9000`.
  `infra/.env` sets `MINIO_CONTAINER=minio` so dev-up reuses it.
- **WSL idles out** ~1 min after the last WSL process exits, stopping MariaDB/MinIO. `infra/dev-up.ps1` starts a keep-alive.
  If tests fail with ConnectException, run `.\infra\dev-up.ps1` first.
- `server/.env` currently uses the MariaDB `root` account (should be the `halqo` user, see owner questions).
- Owner's MinIO also has unrelated buckets `halqo`, `myapp` — leave them alone.

## Phase 0 plan

- [x] Root `CLAUDE.md`, `.gitignore`, `.pre-commit-config.yaml`, `.gitleaks.toml`, `.editorconfig`
- [x] `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `Makefile`, `LICENSE` (AGPL-3.0)
- [x] `core/`, `server/`, `app/` `CLAUDE.md`
- [x] `.github/workflows/` (ci-core, ci-server, ci-app with path filters; secret-scan gitleaks), `dependabot.yml`, `CODEOWNERS`
- [x] `infra/docker-compose.yml` (MinIO only, Chainguard image), `infra/dev-up.sh`, `infra/dev-up.ps1`, `.env.example`s
- [x] Server skeleton: S3 presigner (public endpoint, path-style), `/dev/presign-put` (profile `local` only)
- [x] Server tests (7, all passing locally): `MediaUrlSignerTest` (3), `DevPresignControllerTest` (1),
      `DatabaseConnectivityIT` (halqo_test), `PresignedUploadIT` (2: PUT/GET round trip, unsigned → 403)
- [x] Smoke test: server with profile `local` connects to the `halqo` DB (Flyway history table created);
      `/dev/presign-put` → PUT/GET via `http://<LAN_IP>:9000/halqo-media` works from Windows
- [x] Buckets `halqo-media`, `halqo-media-test` created (private)
- [x] `docs/CRYPTO.md` (draft), `docs/THREAT_MODEL.md` (draft), `docs/DEV_SETUP.md` (Windows-first), `docs/api/openapi.yaml` stub
- [ ] `pre-commit run --all-files` clean, PR `phase-0-foundation` merged with CI green
- [ ] Owner: MinIO console + presigned PUT from a phone (see "Needs manual check")
- [ ] Owner: review/approve CRYPTO.md and THREAT_MODEL.md

## Phase 1 (Rust crypto core) — summary

- [x] CRYPTO.md v1.0 + THREAT_MODEL v1.0 approved (owner delegated: "most secure option")
- [x] `core/` crate `halqo-core`: AEAD envelope, Padmé, circle chain + per-post key refs, identity/device keys,
      HPKE Auth friend payloads, posts/replies with author signatures, chunked media STREAM, backups,
      BIP39 recovery, OPAQUE client and server, encrypted blobs, push-token sealing, handle lookup, invites, safety numbers, uniffi FFI
- [x] 59 tests: unit, `tests/flows.rs` (signup A → login B same identity; circle 7 reads 7/9 not 5; 7→9 epoch
      rotation closes new circle-7 posts; replies; media), `tests/tamper.rs` (property tests, every ciphertext type)
- [x] Test vectors committed (`core/test_vectors/vectors_TEST_ONLY.json`) + published vectors (RFC 5869, BIP39, XChaCha draft)
- [x] 7 cargo-fuzz targets (CI runs 30 s each on nightly)
- [x] 200 MB file: encrypt+decrypt in 0.6 s with 8 MB peak working set (release, Windows)
- [x] CI green, merged (PR #3); CI fuzzing found the OPAQUE server-state rule (see decisions)

## Phase 2 (RN binding + app shell) — summary

- [x] Expo SDK 58 app in `app/` (`@halqo/app`, RN 0.88, expo-router, NativeWind 4.2 + Tailwind 3.4, brand tokens, dark mode)
- [x] Drawer (Profile, Circles, Devices, Settings, Recovery phrase, Log out) + 4 icon-only tabs + Home header + FABs + empty states
- [x] `@halqo/core` generated from `core/` by uniffi-bindgen-react-native 0.31 **jsi2** flavour (`app/modules/halqo-core`);
      app depends directly on `@ubjs/react-native`
- [x] Dev screen "Crypto self-test" (`halqo://dev`, dev builds only)
- [x] typecheck, lint, 9 jest tests pass
- [x] **Android emulator (API 36.1, x86_64): all self-tests PASS** — blob tamper rejected, circle 7 reads 7/9 not 5
      (payload 160 B), recovery phrase, OPAQUE register+login (Argon2id 64 MiB, ~0.5 s debug), 5 MB stream
- [x] **200 MB file streamed on the emulator: PASS, app memory flat (PSS 409 MB before, 408 MB peak during)**; 43 s in
      a debug (unoptimised) Rust build
- [ ] iPhone via EAS dev build (needs owner: Expo account + Apple developer account; see "Waiting on owner")
- [x] CI green, merged (PR #4)

## Phase 3 (server foundations) — summary

- [x] Spring Boot 4.1.2 (decided: 3.5 OSS support over; Boot 4 modules adopted)
- [x] Rust core over JNI (`core/src/jni_bridge.rs`, feature `jni`; test client feature `jni-test-client`); Java facade `HalqoCore`
- [x] Flyway V1: all PLAN.md tables, adjusted per CRYPTO.md §14 (opaque_record, handle_lookup, recovery_pubkey, profile blob)
      + opaque_login_states, recovery_challenges, refresh_tokens
- [x] Endpoints: register start/finish, login start/finish (OPAQUE), refresh (rotating), recovery start/finish,
      password start/finish, backups get/put, devices, identity get/put (docs/api/openapi.yaml)
- [x] JWT (HS256, iss halqo-server, aud halqo-app, scopes full|recovery), refresh tokens stored as hashes
- [x] Rate limits: 30 auth requests/min per client address (hashed in memory), 10 login/recovery attempts/min per handle
- [x] No request-body/IP logging (no access log; error bodies are fixed codes) — `NoPayloadLoggingIT` asserts logs during
      real traffic contain no handles, passwords, tokens, keys, user ids or IPs
- [x] 26 server tests pass locally against halqo_test + halqo-media-test; local server smoke-tested against `halqo`
- [x] CI green, merged (PR #5; CI caught Flyway logging the JDBC URL — silenced)

## Phase 4 (app onboarding) — summary

- [x] Signup: handle + password → OPAQUE → keys + 24-word phrase → confirm 3 words → keys and both encrypted backups uploaded
- [x] Login on a new device: OPAQUE → download + decrypt password backup on the device → rebuild identity locally
      (`identity_from_secrets`) and **refuse if it doesn't match the published keys** → register this device
- [x] Recovery: 24 words → signed challenge → decrypt recovery backup → new password (other sessions revoked)
- [x] Keys in Android Keystore / iOS Keychain via expo-secure-store (`com.halqo.app.keys`, this device only, excluded from backups)
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
- [x] **Emulator, two separate devices (Halqo_Phone_2 = demo_alice, Halqo_Phone_3 = demo_bob):** Alice started a
      chat, Bob's device joined from the Welcome, messages went both ways and decrypted on each phone. DB: 3 MLS
      messages, 0 plaintext hits; two texts of different lengths both stored as 446 bytes (padding)
- [x] app 48 tests, core 66, server 43
- [ ] **Not done yet (carried to Phase 10):** image/video attachments in chats (needs group-scoped media download
      authorization on the server); adding a member's *new* device to existing chats automatically; sign-out should
      revoke the device server-side so stale devices stop being claimed
- [ ] CI green, merge

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-10-25 | **Windows-native dev**, repo at `C:\Users\zaheer\code\halqo`; WSL only for DB + MinIO. CLAUDE.md updated | Owner decision |
| 2026-10-25 | License **AGPL-3.0** | Owner decision (open decision 3) |
| 2026-10-25 | Server secrets in `server/.env` (not `.env.local`), imported via `spring.config.import=optional:file:./.env[.properties]` in profiles `local` and `test` | Owner created `server/.env`; it's git-ignored |
| 2026-10-25 | Target **MariaDB 11.8** with `mariadb-java-client` + `flyway-mysql`; CI uses a `mariadb:11.8` service container | Existing DB is MariaDB; CI matches it. Local dev never uses a DB container |
| 2026-10-25 | MinIO image `cgr.dev/chainguard/minio` (local compose and CI); bucket/user init via the bundled `mc` from dev-up.sh; dropped the `halqo-minio-init` container | `minio/minio` and `minio/mc` are no longer on Docker Hub; Chainguard image has no shell |
| 2026-10-25 | `dev-up.sh` reuses an existing MinIO container if `MINIO_CONTAINER` is set | Owner already runs one on 9000 |
| 2026-10-25 | `infra/dev-up.ps1` (Windows entry point) keeps WSL awake with a hidden `sleep infinity` | WSL idle shutdown stopped MinIO mid-test |
| 2026-10-25 | Spring Boot **3.5.16** (latest 3.x) for now | PLAN.md says Boot 3; asked owner about 4.x (Flyway also warns MariaDB 11.8 is newer than it supports) |
| 2026-10-25 | Data access via `spring-boot-starter-jdbc` (no JPA) | Rows are mostly opaque blobs; plain SQL keeps it obvious what's stored |
| 2026-10-25 | CI gitleaks runs the release binary directly | No license key or third-party action needed |
| 2026-10-25 | gitleaks allow-list includes exact `halqo/v1/...` label strings | They're public KDF labels; gitleaks flagged `"halqo/v1/reply"` as an API key |
| 2026-10-25 | Owner delegated crypto choices ("best possible security, no PII on server, DB theft reveals nothing") → adopted A1–A11 in CRYPTO.md §14 | Owner instruction |
| 2026-10-25 | **OPAQUE (RFC 9807)** replaces Argon2id+Ed25519 challenge login; `ServerSetup` lives in `HALQO_OPAQUE_SERVER_SETUP`, not the DB | Original design let a DB thief guess passwords offline and open password backups |
| 2026-10-25 | Handle required (login name), stored only as `HMAC(HALQO_HANDLE_KEY, handle)`; not searchable unless the user opts in | No plaintext handles in the DB; resolves open decision 1 |
| 2026-10-25 | Every circle change rotates the epoch; profile key is per epoch | Single inward-move payloads would reveal who moved; ex-friends must lose future profile access |
| 2026-10-25 | Backup plaintext is a fixed binary layout, not CBOR | All-secret payload: fully zeroizable, no parser |
| 2026-10-25 | Core crypto crates pinned to one RustCrypto generation (digest 0.10/rand_core 0.6), matching opaque-ke 4; hpke 0.13 (not 0.15, published the same day) | Consistency, audited versions, avoid brand-new releases |
| 2026-10-25 | uniffi 0.31 (matches uniffi-bindgen-react-native 0.31) | Phase 2 binding generator compatibility |
| 2026-10-25 | Server will call halqo-core via JNI for OPAQUE/HMAC/push-token sealing (Phase 3) | "All crypto lives in /core"; no trustworthy Java OPAQUE |
| 2026-10-25 | OPAQUE server login state stays server-side only (Phase 3: short-lived row/cache, single use) | CI fuzzing showed that whoever supplies the state can complete a login; fuzz target now uses a genuine state |
| 2026-10-26 | Expo SDK 58 / RN 0.88 / NativeWind 4.2.7 with Tailwind 3.4.19 | Latest stable; NativeWind 4 requires Tailwind 3 |
| 2026-10-26 | Core bound with ubrn **jsi2** (shared `@ubjs/react-native` player, no per-library C++) | Simplest native build, especially on Windows |
| 2026-10-26 | Generated TS bindings committed; built `.so`/xcframework not (regenerate with `make core-android`) | CI typechecks without Rust; binaries are 20 MB+ debug |
| 2026-10-26 | Colour tokens in `app/src/theme/tokens.js`, shared by Tailwind and `usePalette()` | One source of truth for classes and navigation options |
| 2026-10-26 | Full drawer navigator not rendered in jest (Reanimated 4.7 native init fails under jest-expo); screens/config tested directly, navigation checked on emulator | Upstream incompatibility; avoid fragile hand-written Reanimated mocks |
| 2026-10-26 | Android build pins CMake 4.1.2 via config plugin; Windows LongPathsEnabled=1 | RN codegen object paths exceed 260 chars; ninja ≥1.12 needed |
| 2026-10-26 | **Spring Boot 4.1.2** (owner delegated technical choices) | Boot 3.5 OSS support ended; Flyway in 3.5 warned on MariaDB 11.8 |
| 2026-10-26 | Server crypto via JNI into halqo-core (`jni` 0.21 API), built with profile `server` (panic=unwind) | All crypto in core; a Rust panic becomes a Java exception instead of killing the JVM |
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
| 2026-10-27 | Calling device named by `X-Halqo-Device` header and checked against my devices (tokens have no device claim) | Smallest change to auth; a user can only act as their own devices |
| 2026-10-27 | Server orders commits by epoch from the clear MLS framing (first wins, 409 for the loser) | Prevents forks without reading content |
| 2026-10-27 | gitleaks allowlist moved to `[[allowlists]]`; crate name `libcrux-secrets` allowed only in Cargo.lock | False positive from OpenMLS's dependency list; every rule still applies elsewhere |
| 2026-10-25 | Only `secret-scan / gitleaks` should be a required check | Path-filtered CI workflows don't run on every PR |

## Waiting on owner

- **Decision (Phase 8):** add a per-post read token so only a post's audience can list/add replies and likes
  (THREAT_MODEL leak 14)? Recommended: yes, in Phase 11 with moderation. Needs a new HKDF label
  `halqo/v1/read-token` (CRYPTO.md change).

0. iPhone dev build (Phase 2 criterion): needs an Expo account (`npx eas-cli@latest login`) and an Apple Developer
   account for device provisioning. Then `cd app && npx eas-cli@latest build --profile development --platform ios`.

2. Create the `halqo` MariaDB user (DEV_SETUP §3) and switch `server/.env` off `root`.
3. GitHub web settings (PLAN.md 0B step 5), incl. required check `secret-scan / gitleaks`.
4. Phone checks below.

## Needs manual check

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

- Android `libhalqo_core.so` is currently a debug build (~21 MB, slow); release builds need `--release` in ubrn cargo extras (Phase 12).
- `npm audit` reports advisories in app dev dependencies (Expo toolchain); review in Phase 12 dependency audit.

- Flyway (managed by Boot 3.5) logs "MariaDB 11.8 is newer than this version of Flyway". Works; resolved by a Flyway/Boot upgrade.
- First commit `12fbddb` is authored with a personal email and is already public (can't be undone; future commits
  can use the GitHub noreply address if the owner wants).
