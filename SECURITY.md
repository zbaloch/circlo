# Security policy

Security reports are very welcome.

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private vulnerability reporting:
go to the **Security** tab of this repository and click **Report a vulnerability**.

Include, if you can:
- what is affected (`server/`, `app/`, the web app, a doc in `docs/`)
- steps to reproduce or a proof of concept
- the impact you think it has

We aim to acknowledge reports within 7 days and will keep you updated while we work on a fix.
We are happy to credit you once a fix is released, unless you prefer to stay anonymous.

## Scope

In scope: the server API, the iOS/Android apps and the web app (app.hellocirclo.com).
Especially interesting: anything that lets someone see a post, reply, photo, message or profile they weren't
shared with; learn which circle someone is in or who a post went to; find or contact people they aren't connected
with; take over an account (login, codes, sessions, password reset); or read data in storage or logs that should
not be there (see [docs/PRIVACY.md](docs/PRIVACY.md)).

## Status

Circlo has not launched yet and hasn't had an external penetration test.
