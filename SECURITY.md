# Security policy

Circlo is an end-to-end encrypted app, so security reports are very welcome.

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private vulnerability reporting:
go to the **Security** tab of this repository and click **Report a vulnerability**.

Include, if you can:
- what is affected (`core/`, `server/`, `app/`, a spec in `docs/`)
- steps to reproduce or a proof of concept
- the impact you think it has

We aim to acknowledge reports within 7 days and will keep you updated while we work on a fix.
We are happy to credit you once a fix is released, unless you prefer to stay anonymous.

## Scope

In scope: the crypto design (`docs/CRYPTO.md`), the Rust core, the server API and the app.
Especially interesting: anything that lets the server or a third party learn plaintext content, names,
circle membership or keys, or lets a friend read posts addressed to a narrower circle than theirs.

## Status

Circlo has **not** yet had an external cryptography audit. Do not rely on it for sensitive communication yet.
