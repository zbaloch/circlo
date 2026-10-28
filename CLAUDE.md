# Circlo — rules for Claude Code

Full spec: `docs/PLAN.md`. Progress and decisions log: `docs/PROGRESS.md` (read it first when resuming).
Each of `core/`, `server/`, `app/` has its own `CLAUDE.md` with part-specific conventions.

- The product is Circlo. Name every project, package, database, bucket, container, bundle ID and config key per docs/PLAN.md section 0A (circlo-core, @circlo/core, com.circlo.server / circlo-server, DBs circlo + circlo_test, buckets circlo-media + circlo-media-test, app com.circlo.app, scheme circlo://, env prefix CIRCLO_, crypto labels circlo/v1/...). Never use "circles" or "orbits" as an identifier.
- Never send plaintext user content, names, emails, circle numbers or private keys to the server.
- All crypto lives in /core (Rust). The app and server never implement crypto primitives themselves.
- Every ciphertext uses AEAD with AAD binding (object type, id, version).
- No logging of request bodies, IPs, or decrypted data anywhere.
- Every phase: tests first; stop at done-criteria and summarise.
- If a feature seems to need server-side plaintext, stop and ask.
- Main dev platform is Windows (owner decision, overrides PLAN.md's WSL repo location). The repo lives at C:\Users\zaheer\code\circlo and Rust, Java/Maven and Node run natively on Windows. Debian WSL2 (mirrored networking) hosts only the existing MySQL/MariaDB and MinIO in Docker.
- Use the EXISTING MySQL (MariaDB 11.8) installed in WSL (databases: circlo, circlo_test), reached from Windows at localhost:3306. Never add a MySQL container.
- MinIO runs in Docker in Debian WSL. Buckets: circlo-media, circlo-media-test.
- Presigned URLs must be signed for http://${LAN_IP}:9000 with path-style access, so phones can reach them.
- THIS REPO IS PUBLIC. Every commit is published forever. Never commit secrets, real user data, production hostnames or credentials of any kind.
- Secrets live in git-ignored .env files (server/.env, infra/.env); commit only .env.example files with placeholder values. All config is read from CIRCLO_* environment variables.
- App signing keys, push keys, google-services.json and GoogleService-Info.plist live in EAS credentials / EAS environment variables, never in the repo. Do not commit app/ios or app/android (Expo prebuild generates them).
- Before every commit run `git status` and check nothing secret is staged; never bypass the pre-commit hook (no --no-verify).
- If you ever see a real secret in the working tree or history, stop and tell me so I can rotate it.
- Commit at the end of each phase with a clear message, on a branch, and open a PR to main.
- UI follows docs/PLAN.md section 2A: Twitter/X-style timeline, tabs, compose sheet and DMs, branded as Circlo with our own logo and colours.
- Style only with NativeWind classes and the tokens in tailwind.config.js; no inline style objects except for animations.
- Never show circle labels or numbers to anyone except the post's author. No reposts/retweets feature.
