# Circlo — rules for Claude Code

Full spec: `docs/PLAN.md` (read its "Current design" section first). Progress and decisions log: `docs/PROGRESS.md`
(read it first when resuming). Each of `server/`, `app/` has its own `CLAUDE.md` with part-specific conventions.

- The product is Circlo. Name every project, package, database, bucket, container, bundle ID and config key per docs/PLAN.md section 0A (com.circlo.server / circlo-server, @circlo/app, DBs circlo + circlo_test, buckets circlo-media + circlo-media-test, app com.circlo.app, scheme circlo://, env prefix CIRCLO_). Never use "circles" or "orbits" as an identifier.
- Owner decision 2026-11-01: no end-to-end encryption. Content travels over HTTPS and is stored as sent; the server decides who may see what. Don't reintroduce device-level encryption without asking.
- Every read of a post, reply, like, photo, chat, profile or circle goes through a server-side access check. Circle names, memberships and a post's audience are returned only to their owner. Other people's emails are never returned.
- Passwords are stored only as Argon2id hashes; email codes, refresh tokens, invite and check tokens only as SHA-256 hashes.
- No logging of request bodies, IPs, names, emails, codes or content anywhere. No tracking data (IPs, locations, devices, last seen) in the schema.
- Every phase: tests first; stop at done-criteria and summarise.
- Main dev platform is Windows (owner decision, overrides PLAN.md's WSL repo location). The repo lives at C:\Users\zaheer\code\circlo and Java/Maven and Node run natively on Windows. Debian WSL2 (mirrored networking) hosts only the existing MySQL/MariaDB and MinIO in Docker.
- Use the EXISTING MySQL (MariaDB 11.8) installed in WSL (databases: circlo, circlo_test), reached from Windows at localhost:3306. Never add a MySQL container.
- MinIO runs in Docker in Debian WSL. Buckets: circlo-media, circlo-media-test.
- Presigned URLs must be signed for http://${LAN_IP}:9000 with path-style access, so phones can reach them.
- THIS REPO IS PUBLIC. Every commit is published forever. Never commit secrets, real user data, production hostnames or credentials of any kind.
- Secrets live in git-ignored .env files (server/.env, infra/.env); commit only .env.example files with placeholder values. All config is read from CIRCLO_* environment variables.
- App signing keys, google-services.json and GoogleService-Info.plist live in EAS credentials / EAS environment variables, never in the repo. Do not commit app/ios or app/android (Expo prebuild generates them).
- Before every commit run `git status` and check nothing secret is staged; never bypass the pre-commit hook (no --no-verify).
- If you ever see a real secret in the working tree or history, stop and tell me so I can rotate it.
- Commit at the end of each phase with a clear message, on a branch, and open a PR to main.
- UI follows docs/PLAN.md section 2A: Twitter/X-style timeline, tabs, compose sheet and DMs, branded as Circlo with our own logo and colours. The same screens run in the web app (app.hellocirclo.com).
- Style only with NativeWind classes and the tokens in tailwind.config.js; no inline style objects except for animations.
- Never show circle labels or numbers to anyone except the post's author. No reposts/retweets feature.
