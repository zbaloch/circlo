# server/ — circlo-server (Spring Boot 4.1, Java 21)

- Maven `com.circlo:circlo-server`, base package `com.circlo.server`, config prefix `circlo.*`, env prefix `CIRCLO_`.
- Owner decision 2026-11-01: no end-to-end encryption. The server stores accounts, posts, replies, chats and media as
  they are sent (over TLS) and **decides who may see what**. Every read goes through an access check:
  posts via `posts.PostAccess` (author; Everyone = current friends; circles = whoever is in the post's
  circles now, from `post_circles` and `circle_members`), chats via membership, profiles via a connection (`social.People.relation`).
- Circle names, memberships and a post's audience are returned **only to their owner**. Never add them to a view
  another user can fetch. Responses about other people use `People.Person` (name, username, photo), never their email.
- Passwords: Argon2id via `auth.PasswordHasher` only; never stored, logged or returned. Emailed codes are stored only
  as hashes (`auth.EmailCodes`). Refresh tokens, invite tokens and check tokens are stored only as SHA-256.
- Email goes through `mail.EmailSender` (SMTP in production; `circlo.mail.mode=log` prints to the console in the
  local profile; tests capture with `TestMail`). `CIRCLO_JWT_KEY` comes only from the environment.
- Schema changes only via Flyway migrations in `src/main/resources/db/migration` (`V<n>__<name>.sql`). V18 replaced the
  encrypted design's tables. No tracking columns (IPs, locations, devices, last seen): `SchemaIT` enforces this.
- Database: the existing MariaDB/MySQL in WSL. Dev DB `circlo`; tests use `circlo_test` only
  (profile `test`, Flyway clean+migrate per test class). CI uses a MariaDB service container; local dev never does.
- Never log request bodies, headers, IPs, names, emails, codes or content. No access log. Don't add
  `CommonsRequestLoggingFilter`. `NoPayloadLoggingIT` checks it.
- Unit tests: `*Test` (surefire, `mvn test`). DB/S3 tests: `*IT` (failsafe, `mvn verify`) extend `IntegrationTest`
  (random port, Flyway clean+migrate per class, generated JWT key); `TestUser` signs up through the real code flow.
- Boot 4 module names: `spring-boot-starter-webmvc`, `spring-boot-starter-flyway` (without it migrations don't run),
  `spring-boot-starter-webmvc-test`. Jackson 3. Error responses are `{"error": code}` plus fixed details only.
- The web app calls the API from the browser: allowed origins in `CIRCLO_CORS_ORIGINS`.
- Endpoints under `/dev/**` exist only in profile `local`.
- API contract: `docs/api/openapi.yaml`, kept in sync with controllers.
