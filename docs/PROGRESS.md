# Halqo build progress

Memory file for Claude Code sessions. Read this first when resuming. Keep it accurate.

## Current status

**Phase 0 — in progress, blocked on owner input** (see "Waiting on owner").
No git repo, no commits yet: nothing is committed until the commit identity and license are decided.

| Phase | Status |
|---|---|
| 0 Repo, spec, local infra | In progress (files written; blocked on owner input) |
| 1–12 | Not started |

## Environment findings (2026-10-25)

- Workspace was opened at `C:\Users\zaheer\code\halqo` (Windows side). PLAN.md/CLAUDE.md say the repo must live in
  WSL `~/code/halqo`, which doesn't exist yet.
- Windows has: git 2.56, gh 2.86 (logged in as `zbaloch`), Java 21, Maven 3.9.12, Node 24, Docker CLI. No Rust, pre-commit, gitleaks.
- Debian WSL has: git, Docker 26.1 (native engine), **MariaDB 11.8.6** (not MySQL 8), systemd on.
  Missing: Rust, Java, Maven, Node, gh, pre-commit, gitleaks. `sudo` needs a password, so apt installs need the owner.
- `.wslconfig` already has `networkingMode=mirrored` (+ `hostAddressLoopback=true`).
- **Port 9000 is taken** in WSL Docker by `libredesk_app` (another project). MinIO needs 9000.
- GitHub repo `zbaloch/halqo` does not exist yet.
- Global git email is a personal address; PLAN.md wants the GitHub noreply address `8920243+zbaloch@users.noreply.github.com`.

## Phase 0 plan

- [x] Root `CLAUDE.md` (PLAN.md section 5), `.gitignore` (0B step 2)
- [x] `.pre-commit-config.yaml` (gitleaks v8.30.1, pre-commit-hooks v6.0.0), `.gitleaks.toml`, `.editorconfig`
- [x] `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `Makefile`
- [ ] `LICENSE` — blocked on open decision 3
- [x] `core/`, `server/`, `app/` `CLAUDE.md`
- [x] `.github/workflows/` (ci-core, ci-server, ci-app with path filters; secret-scan gitleaks), `dependabot.yml`, `CODEOWNERS`
- [x] `infra/docker-compose.yml` (MinIO only), `infra/.env.example`, `infra/dev-up.sh`
- [x] Server skeleton: `HalqoServerApplication`, S3 presigner (public endpoint, path-style), `/dev/presign-put` (profile `local` only)
- [x] Server tests: `MediaUrlSignerTest` (3), `DevPresignControllerTest` (1) — passing; `DatabaseConnectivityIT` written, needs DB
- [x] `docs/CRYPTO.md` (draft), `docs/THREAT_MODEL.md` (draft), `docs/DEV_SETUP.md`, `docs/api/openapi.yaml` stub
- [ ] git init in final location, pre-commit install, `pre-commit run --all-files`
- [ ] First commit + public GitHub repo + push
- [ ] Run `DatabaseConnectivityIT` against `halqo_test`
- [ ] `infra/dev-up.sh` brings everything up
- [ ] CI green (secret-scan + ci-server)

## Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-10-25 | Target **MariaDB 11.8** (the existing WSL install) with `mariadb-java-client` + `flyway-mysql`; CI uses a `mariadb:11.8` service container | Rule: use the existing DB. It's MariaDB, so match it in CI. Local dev never uses a DB container |
| 2026-10-25 | Spring Boot **3.5.16** (latest 3.x) | PLAN.md says Boot 3. Asked owner whether to move to 4.x |
| 2026-10-25 | Data access via `spring-boot-starter-jdbc` (no JPA) | Rows are mostly opaque blobs; plain SQL keeps it obvious what's stored |
| 2026-10-25 | Secrets loaded via `spring.config.import=optional:file:./.env.local[.properties]` in profiles `local` and `test` | `.env.local` KEY=value lines are valid properties; no extra library |
| 2026-10-25 | CI gitleaks runs the release binary directly (not gitleaks-action) | No license key or third-party action needed |
| 2026-10-25 | MinIO healthcheck uses `mc ready local` | MinIO images no longer ship curl |
| 2026-10-25 | Only `secret-scan / gitleaks` should be a required check | Path-filtered CI workflows don't run on every PR |
| 2026-10-25 | `minio/minio:latest` kept as in PLAN.md | Upstream changed its image publishing in 2025; revisit if `latest` is stale |

## Waiting on owner

See the numbered questions in the latest session summary; mirrored here:
1. Repo location (WSL `~/code/halqo` per rules, vs. keep on Windows).
2. Commit identity (noreply email).
3. License (open decision 3).
4. Port 9000 conflict with `libredesk_app`.
5. DB + user creation in MariaDB (needs sudo) and `server/.env.local`, `infra/.env`.
6. Toolchain installs needing sudo in WSL (pipx), GitHub web settings after first push.
7. Review `docs/CRYPTO.md` incl. section 13 (A1–A6, P1, Q1) before Phase 1.
8. Spring Boot 3.5 vs 4.x.

## Needs manual check

- (Phase 0) MinIO console at `http://<LAN_IP>:9001` from Windows and from a phone on the same Wi-Fi.
- (Phase 0) `POST /dev/presign-put`, then `curl -X PUT --data-binary @file "<putUrl>"` from the phone (or a phone
  HTTP client app); `GET <getUrl>` returns the same bytes.

## Known issues

- None yet.
