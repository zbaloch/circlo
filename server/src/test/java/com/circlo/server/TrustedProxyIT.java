package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;

/**
 * Behind a trusted proxy (here: loopback) the auth rate limit is per real client, taken from X-Forwarded-For, so one
 * busy client can't lock everyone else out by sharing the proxy's address.
 */
@TestPropertySource(properties = {
        "server.tomcat.remoteip.internal-proxies=127\\.0\\.0\\.1|0:0:0:0:0:0:0:1",
        "circlo.auth.ip-requests-per-minute=2"})
class TrustedProxyIT extends IntegrationTest {

    private int status(String forwardedFor) {
        return http().post().uri("/v1/auth/refresh")
                .header("X-Forwarded-For", forwardedFor)
                .contentType(MediaType.APPLICATION_JSON).body(Map.of("refreshToken", "x"))
                .retrieve().onStatus(s -> true, (req, res) -> {}).toBodilessEntity().getStatusCode().value();
    }

    @Test
    void authLimitIsPerForwardedClient() {
        assertThat(status("203.0.113.7")).isEqualTo(401);
        assertThat(status("203.0.113.7")).isEqualTo(401);
        assertThat(status("203.0.113.7")).isEqualTo(429);
        assertThat(status("198.51.100.1")).isEqualTo(401);
    }
}
