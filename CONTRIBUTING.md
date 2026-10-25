# Contributing to Halqo

Thanks for your interest. A few rules matter more here than in most projects, because Halqo is
end-to-end encrypted and this repository is public.

## Ground rules

- **Never commit secrets** (passwords, API keys, signing keys, `.env` files, `google-services.json`, ...).
  Copy `*.env.example` to the git-ignored `.env` / `.env.local` files and put real values there.
- **The server must never receive plaintext** content, names, emails, circle numbers or private keys.
- **All crypto lives in `core/`** and follows [docs/CRYPTO.md](docs/CRYPTO.md). Changes to the crypto design
  need a spec change and review first.
- **No logging** of request bodies, IPs or decrypted data.
- Use test fixtures with obviously fake values. Never real user data.

## Setup

1. Follow [docs/DEV_SETUP.md](docs/DEV_SETUP.md).
2. Install the hooks: `pre-commit install` (runs gitleaks and basic checks on every commit). Never use `--no-verify`.

## Workflow

- Branch from `main`, keep commits small, open a pull request.
- Write tests first. CI must be green (per-folder checks plus the required `gitleaks` scan).
- Checks per part:
  - `core/`: `cargo fmt --check && cargo clippy -- -D warnings && cargo test`
  - `server/`: `mvn verify`
  - `app/`: `npm run typecheck && npm run lint && npm test`

## Security issues

Report privately, never in a public issue. See [SECURITY.md](SECURITY.md).
