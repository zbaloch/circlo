# Halqo build progress

Memory file for Claude Code sessions. Read this first when resuming. Keep it accurate.

## Current status

| Phase | Status |
|---|---|
| 0 Repo, spec, local infra | **In progress** — local criteria pass; waiting on: CI green on PR, owner review of CRYPTO.md, phone check |
| 1 Rust crypto core | Blocked on CRYPTO.md approval (section 13 items) |
| 2–12 | Not started |

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
| 2026-10-25 | Only `secret-scan / gitleaks` should be a required check | Path-filtered CI workflows don't run on every PR |

## Waiting on owner

1. Review `docs/CRYPTO.md` section 13 (A1–A6, P1, Q1) and THREAT_MODEL.md — blocks Phase 1.
2. Spring Boot 3.5 vs 4.x — needed before Phase 3.
3. Create the `halqo` MariaDB user (DEV_SETUP §3) and switch `server/.env` off `root`.
4. GitHub web settings (PLAN.md 0B step 5), incl. required check `secret-scan / gitleaks`.
5. Phone checks below.

## Needs manual check

- (Phase 0) MinIO console opens at `http://<LAN_IP>:9001` from a phone on the same Wi-Fi.
- (Phase 0) Presigned PUT from the phone: on Windows run `.\infra\dev-up.ps1`, start the server
  (`cd server; mvn spring-boot:run "-Dspring-boot.run.profiles=local"`), then on the phone (same Wi-Fi) open an HTTP
  client app (e.g. "HTTP Shortcuts" / "API Tester"): `POST http://<LAN_IP>:8080/dev/presign-put`, copy `putUrl`,
  send `PUT <putUrl>` with any small body → expect 200; open `getUrl` in the phone browser → same body.
  If it times out, add the firewall rules in DEV_SETUP §2.

## Known issues

- Flyway (managed by Boot 3.5) logs "MariaDB 11.8 is newer than this version of Flyway". Works; resolved by a Flyway/Boot upgrade.
- First commit `12fbddb` is authored with a personal email and is already public (can't be undone; future commits
  can use the GitHub noreply address if the owner wants).
