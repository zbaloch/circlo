# Halqo local development setup (Windows + Debian WSL2)

The repo lives **inside the WSL filesystem** (`~/code/halqo`), not under `/mnt/c/`.

## 1. WSL networking (once, on Windows)

`%UserProfile%\.wslconfig`:
```ini
[wsl2]
networkingMode=mirrored
```
Then `wsl --shutdown` in PowerShell and reopen Debian. Services in WSL now listen on the Windows LAN IP.

Allow inbound ports in Windows Defender Firewall (Private profile). In an **admin** PowerShell:
```powershell
New-NetFirewallRule -DisplayName "Halqo API 8080"      -Direction Inbound -Protocol TCP -LocalPort 8080 -Profile Private -Action Allow
New-NetFirewallRule -DisplayName "Halqo MinIO 9000"    -Direction Inbound -Protocol TCP -LocalPort 9000 -Profile Private -Action Allow
New-NetFirewallRule -DisplayName "Halqo MinIO UI 9001" -Direction Inbound -Protocol TCP -LocalPort 9001 -Profile Private -Action Allow
```
With mirrored networking, also allow Hyper-V firewall inbound for WSL:
```powershell
Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow
```

Find your LAN IP with `ipconfig` (Wi-Fi or Ethernet IPv4). Use it as `LAN_IP` below.

## 2. Existing database (never a container)

Halqo uses the database server already installed in WSL (currently MariaDB 11.8, MySQL-compatible).
```bash
sudo systemctl start mariadb     # or mysql
sudo mariadb <<'SQL'
CREATE DATABASE IF NOT EXISTS halqo      CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;
CREATE DATABASE IF NOT EXISTS halqo_test CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;
CREATE USER IF NOT EXISTS 'halqo'@'localhost' IDENTIFIED BY 'change-me';  -- your own password; put it only in server/.env.local
GRANT ALL PRIVILEGES ON halqo.*      TO 'halqo'@'localhost';
GRANT ALL PRIVILEGES ON halqo_test.* TO 'halqo'@'localhost';
FLUSH PRIVILEGES;
SQL
```
(On real MySQL 8 use `utf8mb4_0900_ai_ci`.)

## 3. Docker in Debian (for MinIO)

Either Docker Desktop with WSL integration for Debian, or Docker Engine inside Debian (see PLAN.md 0.3).
Check: `docker run --rm hello-world`. Ports 9000 and 9001 must be free (`docker ps`, `ss -ltnp | grep -E ':900[01]'`).

## 4. Toolchains (inside Debian)

| Tool | Install |
|---|---|
| Rust | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh -s -- -y` |
| Java 21 + Maven | `sdk install java 21-tem && sdk install maven` (via https://sdkman.io) or `apt install openjdk-21-jdk maven` |
| Node 24 | `nvm install 24` (via https://github.com/nvm-sh/nvm) |
| GitHub CLI | https://github.com/cli/cli/blob/trunk/docs/install_linux.md, then `gh auth login` |
| pre-commit | `sudo apt-get install -y pipx && pipx install pre-commit` |
| gitleaks | release binary from https://github.com/gitleaks/gitleaks/releases into `~/.local/bin` |
| Android (Phase 2+) | Android SDK cmdline-tools + NDK in WSL, `cargo install cargo-ndk`, `rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android` |

## 5. Secrets and config

```bash
cp infra/.env.example  infra/.env          # MinIO root + app credentials, LAN_IP
cp server/.env.example server/.env.local   # DB password, S3 endpoint http://<LAN_IP>:9000, S3 app credentials
pre-commit install
```
Both files are git-ignored. Never commit them.

## 6. Run

```bash
make dev                                             # DB (existing) + MinIO; prints URLs
cd server && SPRING_PROFILES_ACTIVE=local mvn spring-boot:run
```
- MinIO console: `http://<LAN_IP>:9001` (from Windows and from a phone on the same Wi-Fi).
- Smoke-test presigned upload (profile `local` only):
  ```bash
  curl -s -X POST http://<LAN_IP>:8080/dev/presign-put        # returns objectKey, putUrl, getUrl
  curl -X PUT --data-binary @somefile "<putUrl>"               # from any machine/phone on the LAN
  curl -o out "<getUrl>"
  ```

## 7. Tests

```bash
make test              # core + server (unit + integration against halqo_test) + app
make scan              # pre-commit on all files + gitleaks over history
```

## 8. Mobile

- **Android:** emulator on Windows or a phone on the same Wi-Fi. API base URL `http://<LAN_IP>:8080` in `app/.env`
  (`EXPO_PUBLIC_API_URL`). Cleartext HTTP is allowed in dev builds only.
- **iOS:** needs a Mac or EAS Build. Build a dev client with `eas build --profile development --platform ios` and install
  it on a physical iPhone.
- The Rust core cross-compiles for Android in WSL (`make core-android`); the iOS framework builds in EAS or on a Mac.

## 9. GitHub required checks

Only `secret-scan / gitleaks` should be a *required* status check. The per-folder CI workflows use path filters and
don't run on every PR, so making them required would block PRs that don't touch that folder.
