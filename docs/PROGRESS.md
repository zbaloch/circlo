# Halqo build progress

Memory file for Claude Code sessions. Read this first when resuming. Keep it accurate.

## Current status

| Phase | Status |
|---|---|
| 0 Repo, spec, local infra | Done (merged PR #2); phone check still manual |
| 1 Rust crypto core | Done (merged PR #3) |
| 2 RN binding + app shell | Done on Android (merged PR #4); iPhone EAS build pending owner's Expo/Apple accounts |
| 3 Server foundations | Done (merged PR #5) |
| 4 App onboarding | **In progress** on `phase-4-onboarding` |
| 5–12 | Not started |

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
| 2026-10-25 | Only `secret-scan / gitleaks` should be a required check | Path-filtered CI workflows don't run on every PR |

## Waiting on owner

0. iPhone dev build (Phase 2 criterion): needs an Expo account (`npx eas-cli@latest login`) and an Apple Developer
   account for device provisioning. Then `cd app && npx eas-cli@latest build --profile development --platform ios`.

2. Create the `halqo` MariaDB user (DEV_SETUP §3) and switch `server/.env` off `root`.
3. GitHub web settings (PLAN.md 0B step 5), incl. required check `secret-scan / gitleaks`.
4. Phone checks below.

## Needs manual check

- (Phase 2) On a physical Android phone and an iPhone dev build: open drawer → "Crypto self-test" → Run checks (all PASS)
  and "Stream 200 MB" (PASS, app stays responsive). Also toggle system dark mode and confirm colours switch.

- (Phase 0) MinIO console opens at `http://<LAN_IP>:9001` from a phone on the same Wi-Fi.
- (Phase 0) Presigned PUT from the phone: on Windows run `.\infra\dev-up.ps1`, start the server
  (`cd server; mvn spring-boot:run "-Dspring-boot.run.profiles=local"`), then on the phone (same Wi-Fi) open an HTTP
  client app (e.g. "HTTP Shortcuts" / "API Tester"): `POST http://<LAN_IP>:8080/dev/presign-put`, copy `putUrl`,
  send `PUT <putUrl>` with any small body → expect 200; open `getUrl` in the phone browser → same body.
  If it times out, add the firewall rules in DEV_SETUP §2.

## Known issues

- Android `libhalqo_core.so` is currently a debug build (~21 MB, slow); release builds need `--release` in ubrn cargo extras (Phase 12).
- `npm audit` reports advisories in app dev dependencies (Expo toolchain); review in Phase 12 dependency audit.

- Flyway (managed by Boot 3.5) logs "MariaDB 11.8 is newer than this version of Flyway". Works; resolved by a Flyway/Boot upgrade.
- First commit `12fbddb` is authored with a personal email and is already public (can't be undone; future commits
  can use the GitHub noreply address if the owner wants).
