package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;

/** With no trusted proxy (the default), X-Forwarded-For is ignored: a client can't dodge the limit by faking it. */
@TestPropertySource(properties = "circlo.auth.ip-requests-per-minute=2")
class UntrustedForwardedForIT extends IntegrationTest {

    private int status(String forwardedFor) {
        return http().post().uri("/v1/auth/refresh")
                .header("X-Forwarded-For", forwardedFor)
                .contentType(MediaType.APPLICATION_JSON).body(Map.of("refreshToken", "x"))
                .retrieve().onStatus(s -> true, (req, res) -> {}).toBodilessEntity().getStatusCode().value();
    }

    @Test
    void spoofedForwardedForIsIgnored() {
        assertThat(status("203.0.113.1")).isEqualTo(401);
        assertThat(status("203.0.113.2")).isEqualTo(401);
        assertThat(status("203.0.113.3")).isEqualTo(429);
    }
}
