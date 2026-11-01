# Circlo

Circlo is a private, circles-based social network. You share posts with **circles** (Close Friends, Family, Colleagues, or your own), with all your friends, or only with yourself. People connect only through an invite link or QR
code: there is no search, no public profile, no ads and no tracking. Nobody is ever told which circle they're in.

Apps for iOS and Android, and a web app at **app.hellocirclo.com**, all from the same code.

> **Status: early development, not yet launched.**

## How it works (short version)

- **Accounts** have a name, @username, email and password. The email is confirmed with a 6-digit code; a forgotten
  password is reset the same way. Passwords are stored only as Argon2id hashes.
- **The server decides who sees what.** Everything travels over HTTPS (TLS) and is stored as sent. A post to a
  circle reaches the people who were in that circle when it was posted; Everyone means all current friends.
  Unfriending or blocking someone always removes their access. Circle names and memberships, and who a post went to,
  are shown only to the person who owns them.
- **Photos and videos** have their location and camera metadata removed on the device before upload, and are served
  from a private bucket through short-lived links.
- **No remote push.** A phone that opts in checks for new activity itself and shows a local notification with counts.

Details: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), [docs/PRIVACY.md](docs/PRIVACY.md) (everything the server
stores, and what it never collects), [docs/PLAN.md](docs/PLAN.md), the API in [docs/api/openapi.yaml](docs/api/openapi.yaml).

## Repository layout

| Folder | What | Tooling |
|---|---|---|
| `server/` | `circlo-server`, Spring Boot 4 / Java 21 API | Maven |
| `app/` | `@circlo/app`, the Expo / React Native app for iOS, Android and the web | npm |
| `infra/` | Local MinIO (Docker Compose) and the dev-up script | Docker |
| `docs/` | Plan, threat model, privacy, hardening, dev setup, OpenAPI contract | |

## Running locally

See [docs/DEV_SETUP.md](docs/DEV_SETUP.md). In short:

```bash
cp infra/.env.example infra/.env          # fill in real local values
cp server/.env.example server/.env        # fill in real local values
make dev                                  # starts the database (existing install) + MinIO
make test                                 # runs all test suites
make web                                  # builds the web app into app/dist
```

## Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## License

See [LICENSE](LICENSE).
