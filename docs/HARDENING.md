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
bucket as end-to-end encrypted ciphertext, checked by AEAD on the phone.

## Rooted / jailbroken phones

The app checks once per launch (`expo-device` `isRootedExperimentalAsync`) and, if the phone looks rooted or
jailbroken, shows a dismissible warning on Home and a permanent note in Settings. It only warns: the check is
heuristic and easy to fool, and blocking would mostly hurt honest users.

## Reproducible builds

- **Server jar:** `project.build.outputTimestamp` is fixed in `server/pom.xml`, so two clean builds of a commit are
  byte-identical. CI (ci-server) builds twice and compares.
- **Rust core:** `core/scripts/check-reproducible.sh` builds the release library from two copies of the source in
  different directories (paths remapped) and compares hashes. CI (ci-core, job `reproducible`) runs it.
- **App:** dependencies are locked (`package-lock.json`, `npm ci`), and the native core is built with the Cargo
  profile `app` (`make core-android-release`). Mobile app packages are signed by EAS, so they can't be compared
  byte for byte. Instead, compare the extracted `libcirclo_core.so` and JS bundle with a local build of the same
  commit.

## Dependency audit

- **CI `deps-audit`** (on lockfile changes, on main and weekly): osv-scanner over `core/Cargo.lock`, both npm
  lockfiles and `server/pom.xml`, plus `cargo deny` (RustSec advisories, licences compatible with AGPL-3.0,
  crates.io only). Accepted findings live in `osv-scanner.toml`, each with a reason and an expiry date.
- Dependabot opens weekly update PRs for Cargo, Maven, npm and GitHub Actions.

## Leaked-database drill

Pretend a thief copied the database and the bucket, but not the server's secrets:

```sh
# in WSL, from infra/ (markers.txt: text you typed into the app while testing, kept outside the repo)
./leak-drill.sh /path/to/markers.txt /path/to/server.log
```

It dumps `circlo` and every bucket object to a temporary directory, then checks for:

- the marker strings (in UTF-8, UTF-16 and hex);
- image and video signatures or metadata;
- email and IP addresses;
- objects that don't look like ciphertext (entropy under 7.9 bits per byte).

Afterwards it deletes the copy. `infra/test_leak_drill.py` proves the scanner catches each kind of leak.

## Load test

```sh
cd server && mvn verify -Dcirclo.excludedGroups= -Dit.test=LoadIT -Dtest=NoSuchTest -Dsurefire.failIfNoSpecifiedTests=false
# options: -Dcirclo.load.clients=64 -Dcirclo.load.seconds=30 -Dcirclo.load.users=24
```

Real accounts register and log in through OPAQUE. Then many clients mix the app's most frequent calls:

- feed pages (70%);
- batch stats with read tokens (15%);
- new posts (10%);
- likes (5%).

The test fails on any error, or if the p95 for the feed, stats or posts reaches 500 ms or more.

## Rate limiting

The server limits auth attempts per client address, login and recovery attempts per handle, and a few costly
actions per user (`web.RateLimiter`: Bucket4j token buckets in a Caffeine cache). Buckets live in memory only; keys are
salted hashes and are dropped once idle, so no IP-derived data is ever stored (PRIVACY.md).

- **Behind a reverse proxy or load balancer**, set `CIRCLO_TRUSTED_PROXIES` to a regex matching the proxy's own
  address(es), e.g. `10\.0\.0\.\d+`. Tomcat's `RemoteIpValve` then takes the client address from `X-Forwarded-For`,
  but only when the request comes from a trusted proxy. Left empty (the default), no proxy is trusted and forwarded
  headers are ignored, so clients can't spoof their address. The proxy must overwrite, not append to, any
  `X-Forwarded-For` it receives from clients.
- **With more than one server instance**, each enforces its own limits. Put the shared per-IP limit at the edge
  (nginx `limit_req`, the load balancer or the CDN/WAF) for `/v1/auth/*` and `/v1/device-links/*`. Login guessing
  stays expensive regardless: every OPAQUE attempt costs the client an Argon2id at 64 MiB.
