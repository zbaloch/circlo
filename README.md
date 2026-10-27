# Halqo

Halqo is an end-to-end encrypted social network. You share posts with **circles**: nested audiences from
"only me" (1) out to your widest contacts (100). The server only ever stores ciphertext. It never sees
your posts, media, name, email or which circle anyone is in.

> **Status: early development. Not audited. Do not use for anything sensitive.**
> An external cryptography audit is required before any public launch.

## How it works (short version)

- **Circles are a one-way key chain.** `C(n+1) = HKDF(Cn)`. A friend placed in circle *k* receives only `Ck`.
  From it they can derive wider circles but never narrower ones. Every friend receives one key of identical size,
  so the server can't tell who is in which circle, and friends are never told their circle.
- **Messaging uses MLS** (RFC 9420, via OpenMLS) for both 1:1 and group chats.
- **Login without revealing your password.** Your device derives a signing key from your password with Argon2id;
  the server stores only the public key and verifies a signed challenge.

Details: [docs/CRYPTO.md](docs/CRYPTO.md), [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), [docs/PRIVACY.md](docs/PRIVACY.md) (everything the server stores, and what it never collects), [docs/PLAN.md](docs/PLAN.md).

## Repository layout

| Folder | What | Tooling |
|---|---|---|
| `core/` | `halqo-core`, the Rust crypto core, exposed to the app via uniffi | Cargo |
| `server/` | `halqo-server`, Spring Boot 3 / Java 21 API (ciphertext store and relay) | Maven |
| `app/` | `@halqo/app`, the Expo / React Native app | npm |
| `infra/` | Local MinIO (Docker Compose) and the dev-up script | Docker |
| `docs/` | Plan, crypto spec, threat model, dev setup, OpenAPI contract | |

## Running locally

See [docs/DEV_SETUP.md](docs/DEV_SETUP.md). In short:

```bash
cp infra/.env.example infra/.env          # fill in real local values
cp server/.env.example server/.env        # fill in real local values
make dev                                  # starts the database (existing install) + MinIO
make test                                 # runs all test suites
```

## Security

Please report vulnerabilities privately. See [SECURITY.md](SECURITY.md).

## License

See [LICENSE](LICENSE).
