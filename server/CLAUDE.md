# server/ — halqo-server (Spring Boot 3, Java 21)

- Maven `com.halqo:halqo-server`, base package `com.halqo.server`, config prefix `halqo.*`, env prefix `HALQO_`.
- The server is an opaque store and relay. It never decrypts anything and never implements crypto
  primitives, except verifying Ed25519 signatures for login (a public-key check, no secrets).
- Schema changes only via Flyway migrations in `src/main/resources/db/migration` (`V<n>__<name>.sql`).
  No `name`, `email`, `circle` or `caption` columns, ever.
- Database: the existing MariaDB/MySQL in WSL. Dev DB `halqo`; tests use `halqo_test` only
  (profile `test`, Flyway clean+migrate per test class). CI uses a MariaDB service container; local dev never does.
- Never log request bodies, headers, IPs or ciphertext. No access log. Don't add `CommonsRequestLoggingFilter`.
- Unit tests: `*Test` (surefire, `mvn test`). DB/S3 tests: `*IT` (failsafe, `mvn verify`).
- Endpoints under `/dev/**` exist only in profile `local`.
- API contract: `docs/api/openapi.yaml`, kept in sync with controllers.
