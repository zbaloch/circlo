# server/ — halqo-server (Spring Boot 4.1, Java 21)

- Maven `com.halqo:halqo-server`, base package `com.halqo.server`, config prefix `halqo.*`, env prefix `HALQO_`.
- The server is an opaque store and relay. It never decrypts user data and never implements crypto. Every crypto
  operation (OPAQUE server, handle HMAC, signature checks, push-token sealing) goes through `crypto.HalqoCore`, the JNI
  facade over the Rust core (`cargo build --features jni --profile server` in core/; tests need `jni-test-client`).
- Server secrets (`HALQO_OPAQUE_SERVER_SETUP`, `HALQO_HANDLE_KEY`, `HALQO_PUSH_TOKEN_KEY`, `HALQO_JWT_KEY`) come only
  from the environment, never the DB. `config.ServerSecrets` refuses to start without them.
- OPAQUE login state stays server-side (`opaque_login_states`), single use; never accept it from a client.
- The handle is never stored: only `users.handle_lookup` (keyed HMAC). Unknown handles must get responses shaped like
  real ones (no account enumeration).
- Schema changes only via Flyway migrations in `src/main/resources/db/migration` (`V<n>__<name>.sql`).
  No `name`, `email`, `circle` or `caption` columns, ever.
- Database: the existing MariaDB/MySQL in WSL. Dev DB `halqo`; tests use `halqo_test` only
  (profile `test`, Flyway clean+migrate per test class). CI uses a MariaDB service container; local dev never does.
- Never log request bodies, headers, IPs or ciphertext. No access log. Don't add `CommonsRequestLoggingFilter`.
- Unit tests: `*Test` (surefire, `mvn test`). DB/S3 tests: `*IT` (failsafe, `mvn verify`) extend `IntegrationTest`
  (random port, Flyway clean+migrate per class, generated test secrets); `TestApp` plays the client via the real core.
- Boot 4 module names: `spring-boot-starter-webmvc`, `spring-boot-starter-flyway` (without it migrations don't run),
  `spring-boot-starter-webmvc-test`. Jackson 3. Error responses are `{"error": code}` only.
- Endpoints under `/dev/**` exist only in profile `local`.
- API contract: `docs/api/openapi.yaml`, kept in sync with controllers.
