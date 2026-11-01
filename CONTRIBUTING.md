# Contributing to Circlo

Thanks for your interest. A few rules matter more here than in most projects, because Circlo holds people's
private posts and this repository is public.

## Ground rules

- **Never commit secrets** (passwords, API keys, signing keys, `.env` files, SMTP credentials, ...).
  Copy `*.env.example` to the git-ignored `.env` files and put real values there.
- **Every read goes through an access check.** The server decides who may see a post, reply, photo, chat or
  profile; circle names and memberships and a post's audience are returned only to their owner.
- **Passwords are only ever hashed** (Argon2id, `server/.../auth/PasswordHasher`). Codes and tokens are stored
  only as hashes.
- **No logging** of request bodies, IPs, names, emails, codes or content. No tracking data in the schema.
- Use test fixtures with obviously fake values. Never real user data.

## Setup

1. Follow [docs/DEV_SETUP.md](docs/DEV_SETUP.md).
2. Install the hooks: `pre-commit install` (runs gitleaks and basic checks on every commit). Never use `--no-verify`.

## Workflow

- Branch from `main`, keep commits small, open a pull request.
- Write tests first. CI must be green (per-folder checks plus the required `gitleaks` scan).
- Checks per part:
  - `server/`: `mvn verify`
  - `app/`: `npm run typecheck && npm run lint && npm test && npm run build:web`

## Security issues

Report privately, never in a public issue. See [SECURITY.md](SECURITY.md).
