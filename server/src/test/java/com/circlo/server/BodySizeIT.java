package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.circlo.server.web.BodySizeFilter;
import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/** A request body over 2 MB is refused before anything reads it, even on signed-out endpoints. */
class BodySizeIT extends IntegrationTest {

    private static final byte[] HUGE = ("{\"email\":\"a@example.com\",\"password\":\"" + "x".repeat((int) BodySizeFilter.MAX_BYTES) + "\"}")
            .getBytes(StandardCharsets.UTF_8);

    private HttpResponse<String> login(HttpRequest.BodyPublisher body) throws Exception {
        HttpRequest req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/v1/auth/login"))
                .header("Content-Type", "application/json").POST(body).build();
        return HttpClient.newHttpClient().send(req, HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void aBodyThatSaysItsTooBigIsRefusedAtOnce() throws Exception {
        HttpResponse<String> r = login(HttpRequest.BodyPublishers.ofByteArray(HUGE));
        assertThat(r.statusCode()).isEqualTo(413);
        assertThat(r.body()).isEqualTo("{\"error\":\"too_large\"}");
    }

    @Test
    void oneSentWithoutALengthIsCutOffAtTheLimit() throws Exception {
        // Streamed (chunked): read only up to 2 MB, then it fails to parse.
        HttpResponse<String> r = login(HttpRequest.BodyPublishers.ofInputStream(() -> new ByteArrayInputStream(HUGE)));
        assertThat(r.statusCode()).isEqualTo(400);
    }

    @Test
    void ordinaryBodiesAreUntouched() throws Exception {
        byte[] small = "{\"email\":\"nobody@example.com\",\"password\":\"not-the-password\"}".getBytes(StandardCharsets.UTF_8);
        // Past the cap, log-in answers as it always does (here: these aren't the fields it wants).
        HttpResponse<String> r = login(HttpRequest.BodyPublishers.ofByteArray(small));
        assertThat(r.statusCode()).isNotEqualTo(413);
        assertThat(r.body()).doesNotContain("too_large");
    }
}
