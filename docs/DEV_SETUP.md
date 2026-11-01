# Circlo local development setup (Windows + Debian WSL2)

**Windows is the main development platform.** The repo lives on the Windows filesystem
(e.g. `C:\Users\<you>\code\circlo`) and Java/Maven and Node run natively on Windows.
Debian on WSL2 only hosts the **existing** MySQL/MariaDB and MinIO (Docker).

## 1. Windows toolchain

| Tool | Install / check |
|---|---|
| Git + Git Bash, GitHub CLI | `winget install Git.Git GitHub.cli`, then `gh auth login` |
| Java 21 + Maven | Temurin 21 (`winget install EclipseAdoptium.Temurin.21.JDK`), Maven 3.9+ |
| Node 24 | `winget install OpenJS.NodeJS` |
| Python + pre-commit | Python 3.12, `python -m pip install --user pre-commit`, then `python -m pre_commit install` in the repo |
| Android | Android Studio (SDK + emulator) |

**Windows long paths (required for the Android build).** React Native's native build creates paths over 260
characters. Once, in an **admin** PowerShell:
```powershell
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force
```
A `subst` drive does **not** work around this (Node and Gradle resolve it back to the real path inconsistently).

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
New-NetFirewallRule -DisplayName "Circlo API 8080"      -Direction Inbound -Protocol TCP -LocalPort 8080 -Profile Private -Action Allow
New-NetFirewallRule -DisplayName "Circlo MinIO 9000"    -Direction Inbound -Protocol TCP -LocalPort 9000 -Profile Private -Action Allow
New-NetFirewallRule -DisplayName "Circlo MinIO UI 9001" -Direction Inbound -Protocol TCP -LocalPort 9001 -Profile Private -Action Allow
Set-NetFirewallHyperVVMSetting -Name '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -DefaultInboundAction Allow
```
Find your LAN IP with `ipconfig` (Wi-Fi or Ethernet IPv4). Use it as `LAN_IP` below.

**WSL idle shutdown:** WSL stops the VM shortly after the last WSL process exits, which takes MariaDB and MinIO
down with it. `infra/dev-up.ps1` starts a hidden keep-alive so this doesn't happen while you work.

## 3. Existing database (never a container)

Circlo uses the database server already installed in WSL (MariaDB 11.8, MySQL-compatible). In Debian:
```bash
sudo mariadb <<'SQL'
CREATE DATABASE IF NOT EXISTS circlo      CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;
CREATE DATABASE IF NOT EXISTS circlo_test CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;
CREATE USER IF NOT EXISTS 'circlo'@'localhost' IDENTIFIED BY 'change-me';  -- your own password; put it only in server/.env
CREATE USER IF NOT EXISTS 'circlo'@'127.0.0.1' IDENTIFIED BY 'change-me';  -- same password; Windows connects over TCP
GRANT ALL PRIVILEGES ON circlo.*      TO 'circlo'@'localhost', 'circlo'@'127.0.0.1';
GRANT ALL PRIVILEGES ON circlo_test.* TO 'circlo'@'localhost', 'circlo'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
```
(On real MySQL 8 use `utf8mb4_0900_ai_ci`.) Don't use the MariaDB `root` account for Circlo.

## 4. MinIO (Docker in Debian)

`infra/docker-compose.yml` runs `circlo-minio` (Chainguard's MinIO image; the `minio/minio` and `minio/mc` images
are no longer published). `infra/dev-up.sh` creates the private buckets `circlo-media` and `circlo-media-test` and the
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

Generate the local JWT key once:
```bash
cd server && mvn -q -DskipTests compile
java -cp target/classes com.circlo.server.tools.GenerateSecrets >> .env   # local-dev secret only; never production
```
In the `local` profile, **emails aren't sent**: the 6-digit signup and password-reset codes are printed in the server
console (`[dev mail] ...`). To send real email, set `CIRCLO_MAIL_MODE=smtp` and the `CIRCLO_MAIL_*` SMTP settings in
`server/.env`. Production always needs SMTP.

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
cd server; mvn verify                    # unit + integration (circlo_test DB, circlo-media-test bucket); needs dev-up
cd app;    npm run typecheck; npm run lint; npm test; npm run build:web
python -m pre_commit run --all-files     # secret scan + hygiene hooks
```

## 8. Mobile

### Android dev build on Windows
```bash
# Git Bash
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
cd app && npx expo run:android                       # builds and installs the dev client on the running emulator
npx expo start --dev-client                          # Metro; open the app on the emulator
```

### Web app
```bash
cd app && npm run web                                # Expo dev server in the browser at http://localhost:8081
npm run build:web                                    # static files in app/dist (deployed to app.hellocirclo.com)
```
The local server allows the browser origin `http://localhost:8081` (`CIRCLO_CORS_ORIGINS`). MinIO must allow it too
for uploads and downloads from the browser: `mc admin config set local api cors_allow_origin="http://localhost:8081"`
(in the minio container), then restart MinIO.


- **Android:** emulator on Windows or a phone on the same Wi-Fi. API base URL `http://<LAN_IP>:8080` in `app/.env`
  (`EXPO_PUBLIC_API_URL`). Cleartext HTTP is allowed in dev builds only.
- **iOS:** needs a Mac or EAS Build: `eas build --profile development --platform ios`, install on a physical iPhone.

## 8A. Push notifications (iPhone and Android)

Pushes are content-free ("New reply", "New message", "New friend request" plus random ids for opening the right
screen) and go from the server straight to Apple (APNs) and Google (FCM); no Expo or other push service in between.
Both platforms get the same pushes and taps open the same screens.

### iPhone (APNs)

1. **Apple key (once):** developer.apple.com → Certificates, IDs & Profiles → **Keys** → **+** → tick **Apple Push
   Notifications service (APNs)** → download `AuthKey_<KEYID>.p8` (only downloadable once; keep it in a password manager,
   never in the repo). Note the **Key ID** and your **Team ID** (top right of the developer site).
2. **App ID:** the release workflow signs automatically, so Xcode adds the Push capability to `com.hellocirclo.app`
   from the `aps-environment` entitlement (`app.config.ts`). If it doesn't, tick **Push Notifications** on the App ID.
3. **Server:** in the server's env file (production: `/opt/circlo/.env`), then restart the server:
   ```
   CIRCLO_APNS_KEY=<output of: base64 -w0 AuthKey_<KEYID>.p8>
   CIRCLO_APNS_KEY_ID=<Key ID>
   CIRCLO_APNS_TEAM_ID=<Team ID>
   ```
   Without them push is off and everything else works (live updates still reach open apps).
4. **Build:** a new store build (release workflow, `APP_VARIANT=production`). TestFlight and App Store builds use Apple's
   **production** push service; development builds register as `apns_sandbox` and use the sandbox. The same .p8 key works
   for both.
5. **Test on real iPhones** (the simulator isn't reliable for push): sign in on two phones, accept the notifications
   prompt (or Settings → Notifications), lock phone A, then from phone B reply to A's post, send A a message and send a
   friend request. Each arrives within seconds as "Circlo · New reply" etc.; tapping opens that reply, chat or the
   requests. Block B on A: B's messages no longer buzz A. Sign out on A: nothing more arrives there.

### Android (FCM)

1. **Firebase project (once):** console.firebase.google.com → **Add project** (Analytics off) → **Add app** → Android,
   package `com.circlo.app` → download **google-services.json** (identifies the app to FCM; keep it out of the repo,
   it's git-ignored).
2. **Build secret:** GitHub → Settings → Environments → `release` → add secret **GOOGLE_SERVICES_JSON_BASE64** with the
   output of `base64 -w0 google-services.json`. The release workflow writes it to a temp file and passes its path to
   `app.config.ts` (`GOOGLE_SERVICES_FILE`). Without it Android builds fall back to background checks.
3. **Server key:** Firebase → Project settings → **Service accounts** → **Generate new private key** (a JSON file; treat
   it like a password). On the server:
   ```
   CIRCLO_FCM_SERVICE_ACCOUNT=<output of: base64 -w0 <that file>.json>
   ```
   and restart. Firebase Cloud Messaging API (V1) must be enabled (it is by default for new projects).
4. **Test** on a real Android phone with a release build, the same way as on iPhone above; Android 13+ asks for the
   notification permission on Circlo's prompt.

## 9. GitHub required checks

Only `secret-scan / gitleaks` should be a *required* status check. The per-folder CI workflows use path filters and
don't run on every PR, so making them required would block PRs that don't touch that folder.
