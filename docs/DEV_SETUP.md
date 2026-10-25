# Halqo local development setup (Windows + Debian WSL2)

**Windows is the main development platform.** The repo lives on the Windows filesystem
(e.g. `C:\Users\<you>\code\halqo`) and Rust, Java/Maven and Node run natively on Windows.
Debian on WSL2 only hosts the **existing** MySQL/MariaDB and MinIO (Docker).

## 1. Windows toolchain

| Tool | Install / check |
|---|---|
| Git + Git Bash, GitHub CLI | `winget install Git.Git GitHub.cli`, then `gh auth login` |
| Java 21 + Maven | Temurin 21 (`winget install EclipseAdoptium.Temurin.21.JDK`), Maven 3.9+ |
| Node 24 | `winget install OpenJS.NodeJS` |
| Rust (MSVC) | Visual Studio Build Tools 2022 with "Desktop development with C++", then `winget install Rustlang.Rustup` |
| Python + pre-commit | Python 3.12, `python -m pip install --user pre-commit`, then `python -m pre_commit install` in the repo |
| Android (Phase 2+) | Android Studio (SDK + emulator + NDK), `cargo install cargo-ndk`, `rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android` |

`make` is optional on Windows (`winget install ezwinports.make`); every Makefile target has a direct command
in the sections below.

## 2. WSL networking (once)

`%UserProfile%\.wslconfig`:
```ini
[wsl2]
networkingMode=mirrored
```
Then `wsl --shutdown`. With mirrored networking, services in WSL are reachable from Windows at `localhost`
and from the LAN at the Windows IP.

Allow inbound ports for phones on the same Wi-Fi. In an **admin** PowerShell:
```powershell
New-NetFirewallRule -DisplayName "Halqo API 8080"      -Direction Inbound -Protocol TCP -LocalPort 8080 -Profile Private -Action Allow
New-NetFirewallRule -DisplayName "Halqo MinIO 9000"    -Direction Inbound -Protocol TCP -LocalPort 9000 -Profile Private -Action Allow
New-NetFirewallRule -DisplayName "Halqo MinIO UI 9001" -Direction Inbound -Protocol TCP -LocalPort 9001 -Profile Private -Action Allow
Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow
```
Find your LAN IP with `ipconfig` (Wi-Fi or Ethernet IPv4). Use it as `LAN_IP` below.

**WSL idle shutdown:** WSL stops the VM shortly after the last WSL process exits, which takes MariaDB and MinIO
down with it. `infra/dev-up.ps1` starts a hidden keep-alive so this doesn't happen while you work.

## 3. Existing database (never a container)

Halqo uses the database server already installed in WSL (MariaDB 11.8, MySQL-compatible). In Debian:
```bash
sudo mariadb <<'SQL'
CREATE DATABASE IF NOT EXISTS halqo      CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;
CREATE DATABASE IF NOT EXISTS halqo_test CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;
CREATE USER IF NOT EXISTS 'halqo'@'localhost' IDENTIFIED BY 'change-me';  -- your own password; put it only in server/.env
CREATE USER IF NOT EXISTS 'halqo'@'127.0.0.1' IDENTIFIED BY 'change-me';  -- same password; Windows connects over TCP
GRANT ALL PRIVILEGES ON halqo.*      TO 'halqo'@'localhost', 'halqo'@'127.0.0.1';
GRANT ALL PRIVILEGES ON halqo_test.* TO 'halqo'@'localhost', 'halqo'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
```
(On real MySQL 8 use `utf8mb4_0900_ai_ci`.) Don't use the MariaDB `root` account for Halqo.

## 4. MinIO (Docker in Debian)

`infra/docker-compose.yml` runs `halqo-minio` (Chainguard's MinIO image; the `minio/minio` and `minio/mc` images
are no longer published). `infra/dev-up.sh` creates the private buckets `halqo-media` and `halqo-media-test` and the
non-root app user. To reuse a MinIO container you already run, set `MINIO_CONTAINER=<name>` in `infra/.env`.
Ports 9000 and 9001 must be free.

## 5. Secrets and config

```powershell
copy infra\.env.example  infra\.env     # MinIO root + app credentials, LAN_IP
copy server\.env.example server\.env    # DB user/password, S3 endpoint http://<LAN_IP>:9000, S3 app credentials
python -m pre_commit install
```
Both `.env` files are git-ignored. Never commit them.

## 6. Run

```powershell
.\infra\dev-up.ps1                       # DB (existing) + MinIO + buckets; keeps WSL awake; prints URLs
cd server; mvn spring-boot:run "-Dspring-boot.run.profiles=local"
.\infra\dev-up.ps1 -Stop                 # when done: let WSL idle again
```
- MinIO console: `http://<LAN_IP>:9001` (from Windows and from a phone on the same Wi-Fi).
- Smoke-test presigned upload (profile `local` only):
  ```bash
  curl -s -X POST http://<LAN_IP>:8080/dev/presign-put        # returns objectKey, putUrl, getUrl
  curl -X PUT --data-binary @somefile "<putUrl>"               # from any machine/phone on the LAN
  curl -o out "<getUrl>"
  ```

## 7. Tests

```powershell
cd server; mvn verify                    # unit + integration (halqo_test DB, halqo-media-test bucket); needs dev-up
cd core;   cargo fmt --check; cargo clippy --all-targets -- -D warnings; cargo test
cd app;    npm run typecheck; npm run lint; npm test
python -m pre_commit run --all-files     # secret scan + hygiene hooks
```

## 8. Mobile

- **Android:** emulator on Windows or a phone on the same Wi-Fi. API base URL `http://<LAN_IP>:8080` in `app/.env`
  (`EXPO_PUBLIC_API_URL`). Cleartext HTTP is allowed in dev builds only.
- **iOS:** needs a Mac or EAS Build: `eas build --profile development --platform ios`, install on a physical iPhone.
- The Rust core cross-compiles for Android on Windows with `cargo ndk`; the iOS framework builds in EAS or on a Mac.

## 9. GitHub required checks

Only `secret-scan / gitleaks` should be a *required* status check. The per-folder CI workflows use path filters and
don't run on every PR, so making them required would block PRs that don't touch that folder.
