# Hardening (Phase 12)

How Circlo's release builds are locked down, and how to repeat each check. See docs/PROGRESS.md for the latest
results.

## Certificate pinning (release builds)

Release builds (`APP_VARIANT=production`) pin the API host's public keys on both platforms: an Android
`network_security_config.xml` `<pin-set>` and iOS `NSPinnedDomains` (`app/plugins/pinning.js`). The host comes from
`EXPO_PUBLIC_API_URL`, and the pins from EAS environment variables, so no production hostname or key is in this repo.

| EAS variable | Value |
|---|---|
| `EXPO_PUBLIC_API_URL` | `https://<api host>` (must be https) |
| `CIRCLO_PIN_SHA256` | Comma-separated base64 SHA-256 SPKI pins: the live key **and at least one backup key** |
| `CIRCLO_PIN_EXPIRES` | Optional `YYYY-MM-DD`. After this date Android stops enforcing the pins (normal TLS still applies), so an old app can't be locked out for good. iOS has no expiry, so keep the backup key safe |
| `CIRCLO_ALLOW_UNPINNED` | `1` only for an internal test build against a host whose key you don't control yet |

A production build **fails** without pins, so pinning can't be forgotten by accident.

Get the live pin from the server's current certificate:

```sh
openssl s_client -connect <host>:443 -servername <host> </dev/null 2>/dev/null \
  | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64
```

Make a backup key, keep it offline, and pin it too:

```sh
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out circlo-backup.key   # store offline, never in git
openssl pkey -in circlo-backup.key -pubout -outform der | openssl dgst -sha256 -binary | base64
```

Renew certificates **with the same key** (e.g. `certbot renew --reuse-key`). To change keys, switch the server to
the backup key, then ship an app update with a new backup pin. Only the API host is pinned: media comes from the
bucket over TLS through short-lived presigned URLs. The web app can't pin; it relies on the browser's TLS and HSTS
(`app/vercel.json`).

## Rooted / jailbroken phones

The app checks once per launch (`expo-device` `isRootedExperimentalAsync`) and, if the phone looks rooted or
jailbroken, shows a dismissible warning on Home and a permanent note in Settings. It only warns: the check is
heuristic and easy to fool, and blocking would mostly hurt honest users.

## Reproducible builds

- **Server jar:** `project.build.outputTimestamp` is fixed in `server/pom.xml`, so two clean builds of a commit are
  byte-identical. CI (ci-server) builds twice and compares.
- **App:** dependencies are locked (`package-lock.json`, `npm ci`). Mobile app packages are signed, so they can't be
  compared byte for byte; compare the JS bundle with a local build of the same commit. The web app's files
  (`npm run build:web`) can be compared directly.

## Dependency audit

- **CI `deps-audit`** (on lockfile changes, on main and weekly): osv-scanner over `app/package-lock.json` and
  `server/pom.xml`. Accepted findings live in `osv-scanner.toml`, each with a reason and an expiry date.
- Dependabot opens weekly update PRs for Maven, npm and GitHub Actions.

## Data at rest

Since 2026-11-01 the database and bucket hold content as written (THREAT_MODEL.md v2.0), so a copy of either is
sensitive. In production:

- turn on the providers' encryption at rest for the database volume, its backups and the bucket (S3 SSE);
- keep production database and bucket credentials to the server and one break-glass account;
- encrypt database backups with a key kept outside the backup store;
- never copy production data to a laptop or a test environment.

The old leaked-database drill (which checked that a dump held only ciphertext) was removed with the encryption.

## Load test

To be rewritten for the new API (the encrypted-era `LoadIT` was removed on 2026-11-01). It should log in many
accounts concurrently, then mix feed pages (70%), posts (15%), replies (10%) and likes (5%), failing on any error or a
p95 of 500 ms or more.

## Rate limiting

The server limits auth attempts per client address, codes emailed per address (5 an hour), login failures per
account (`auth.LoginThrottle`), and a few costly actions per user (`web.RateLimiter`: Bucket4j token buckets in a Caffeine cache). Buckets live in memory only; keys are
salted hashes and are dropped once idle, so no IP-derived data is ever stored (PRIVACY.md).

- **Behind a reverse proxy or load balancer**, set `CIRCLO_TRUSTED_PROXIES` to a regex matching the proxy's own
  address(es), e.g. `10\.0\.0\.\d+`. Tomcat's `RemoteIpValve` then takes the client address from `X-Forwarded-For`,
  but only when the request comes from a trusted proxy. Left empty (the default), no proxy is trusted and forwarded
  headers are ignored, so clients can't spoof their address. The proxy must overwrite, not append to, any
  `X-Forwarded-For` it receives from clients.
- **With more than one server instance**, each enforces its own limits. Put the shared per-IP limit at the edge
  (nginx `limit_req`, the load balancer or the CDN/WAF) for `/v1/auth/*`. Login guessing stays slow regardless: the
  account lock is in the database (shared by every instance), and every check costs the server an Argon2id hash.
