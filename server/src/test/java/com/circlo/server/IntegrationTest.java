package com.circlo.server;

import com.circlo.server.crypto.CircloCore;
import com.circlo.server.web.Ids;
import java.util.Base64;
import java.util.Map;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.client.RestClient;

/**
 * Base for integration tests: real server on a random port, the circlo_test database (Flyway clean + migrate before
 * each test class), and fresh test-only server secrets generated per run (nothing secret is committed).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
public abstract class IntegrationTest {

    @DynamicPropertySource
    static void testSecrets(DynamicPropertyRegistry registry) {
        CircloCore core = new CircloCore(System.getProperty("circlo.core.library", ""));
        Base64.Encoder b64 = Base64.getEncoder();
        byte[] setup = core.opaqueServerSetupNew();
        byte[] handleKey = Ids.random(32);
        byte[] pushKey = Ids.random(32);
        byte[] jwtKey = Ids.random(32);
        registry.add("circlo.secrets.opaque-server-setup", () -> b64.encodeToString(setup));
        registry.add("circlo.secrets.handle-key", () -> b64.encodeToString(handleKey));
        registry.add("circlo.secrets.push-token-key", () -> b64.encodeToString(pushKey));
        registry.add("circlo.secrets.jwt-key", () -> b64.encodeToString(jwtKey));
    }

    @Autowired
    protected Flyway flyway;

    @LocalServerPort
    protected int port;

    @BeforeAll
    void freshDatabase() {
        flyway.clean();
        flyway.migrate();
    }

    protected RestClient http() {
        return RestClient.builder().baseUrl("http://localhost:" + port).build();
    }

    /** POST/GET/PUT that never throws on error statuses; returns status and parsed JSON. */
    @SuppressWarnings("unchecked")
    protected ResponseEntity<Map<String, Object>> call(String method, String path, Object body, String token) {
        RestClient.RequestBodySpec spec = http().method(org.springframework.http.HttpMethod.valueOf(method)).uri(path);
        if (token != null) {
            spec = spec.header("Authorization", "Bearer " + token);
        }
        if (body != null) {
            spec = spec.contentType(MediaType.APPLICATION_JSON).body(body);
        }
        return spec.retrieve().onStatus(s -> true, (req, res) -> {}).toEntity((Class<Map<String, Object>>) (Class<?>) Map.class);
    }

    protected static byte[] b64(Object value) {
        return Base64.getDecoder().decode((String) value);
    }
}
