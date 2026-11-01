package com.circlo.server;

import com.circlo.server.notify.DailyDigests;
import com.circlo.server.web.Ids;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.client.RestClient;

/**
 * Base for integration tests: real server on a random port, the circlo_test database (Flyway clean + migrate before
 * each test class), a fresh test-only JWT key per run (nothing secret is committed), and emails captured by
 * {@link TestMail} instead of being sent.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
@Import({TestMail.class, TestPush.class})
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
public abstract class IntegrationTest {

    @DynamicPropertySource
    static void testSecrets(DynamicPropertyRegistry registry) {
        byte[] jwtKey = Ids.random(32);
        registry.add("circlo.secrets.jwt-key", () -> Base64.getEncoder().encodeToString(jwtKey));
    }

    @Autowired
    protected Flyway flyway;

    @Autowired
    protected TestMail mail;

    @Autowired
    protected TestPush push;

    @Autowired
    protected DailyDigests daily;

    private static final AtomicInteger DAYS = new AtomicInteger();

    /**
     * Sends the daily notifications as if it were `hour`:30 UTC on a day after any earlier call (each person gets at
     * most one a day, so every call is a new day). Returns how many people were told.
     */
    protected int sendDaily(int hour) {
        return daily.sendDue(Instant.parse("2100-01-01T00:30:00Z").plus(Duration.ofDays(DAYS.incrementAndGet())).plus(Duration.ofHours(hour)));
    }

    /** The default hour: 18:00 UTC. */
    protected int sendDaily() {
        return sendDaily(18);
    }

    @LocalServerPort
    protected int port;

    @BeforeAll
    void freshDatabase() {
        flyway.clean();
        flyway.migrate();
    }

    protected RestClient http() {
        // The JDK client never retries on its own (Apache HttpClient would wait out a 429's Retry-After).
        return RestClient.builder().requestFactory(new JdkClientHttpRequestFactory()).baseUrl("http://localhost:" + port).build();
    }

    /** Any method, never throws on error statuses; returns status and parsed JSON object. */
    @SuppressWarnings("unchecked")
    protected ResponseEntity<Map<String, Object>> call(String method, String path, Object body, String token) {
        return (ResponseEntity<Map<String, Object>>) (ResponseEntity<?>) exchange(method, path, body, token, Map.class);
    }

    /** Like {@link #call}, for endpoints that answer with a JSON array. */
    @SuppressWarnings("unchecked")
    protected ResponseEntity<List<Map<String, Object>>> list(String method, String path, Object body, String token) {
        return (ResponseEntity<List<Map<String, Object>>>) (ResponseEntity<?>) exchange(method, path, body, token, List.class);
    }

    private <T> ResponseEntity<T> exchange(String method, String path, Object body, String token, Class<T> type) {
        RestClient.RequestBodySpec spec = http().method(org.springframework.http.HttpMethod.valueOf(method)).uri(path);
        if (token != null) {
            spec = spec.header("Authorization", "Bearer " + token);
        }
        if (body != null) {
            spec = spec.contentType(MediaType.APPLICATION_JSON).body(body);
        }
        return spec.retrieve().onStatus(s -> true, (req, res) -> {}).toEntity(type);
    }

    /** A new, verified account (signed in on one device). */
    protected TestUser user(String username) {
        return new TestUser(this, username, username + "@example.test", TestUser.PASSWORD).signUp();
    }
}
