package com.circlo.server.reading;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * Article images go through Circlo so publishers never see who reads. The links are signed with a key derived from
 * CIRCLO_JWT_KEY and expire, so the image endpoint fetches only images Circlo itself handed out (not an open proxy).
 */
class ReadingImagesTest {

    private static final byte[] KEY = new byte[32];
    private final ReadingImages images = new ReadingImages(KEY);

    private static Map<String, String> params(String path) {
        return UriComponentsBuilder.fromUriString(path).build().getQueryParams().toSingleValueMap();
    }

    @Test
    void aSignedLinkOpensItsImageUntilItExpires() {
        Instant now = Instant.parse("2026-11-27T10:00:00Z");
        String path = images.path("https://blog.example/a.jpg", now);
        assertThat(path).startsWith("/v1/reading/image?u=");
        Map<String, String> p = params(path);
        assertThat(images.verify(p.get("u"), p.get("e"), p.get("s"), now)).contains("https://blog.example/a.jpg");
        assertThat(images.verify(p.get("u"), p.get("e"), p.get("s"), now.plusSeconds(86_400))).isPresent();
        assertThat(images.verify(p.get("u"), p.get("e"), p.get("s"), now.plusSeconds(4 * 86_400))).isEmpty();
    }

    @Test
    void theSameImageHasTheSameLinkAllDaySoPhonesCacheIt() {
        assertThat(images.path("https://blog.example/a.jpg", Instant.parse("2026-11-27T01:00:00Z")))
                .isEqualTo(images.path("https://blog.example/a.jpg", Instant.parse("2026-11-27T23:00:00Z")));
    }

    @Test
    void tamperedLinksAndOtherKeysAreRefused() {
        Instant now = Instant.parse("2026-11-27T10:00:00Z");
        Map<String, String> p = params(images.path("https://blog.example/a.jpg", now));
        Map<String, String> other = params(images.path("http://169.254.169.254/latest", now));
        assertThat(images.verify(other.get("u"), p.get("e"), p.get("s"), now)).isEmpty();
        assertThat(images.verify(p.get("u"), String.valueOf(Long.parseLong(p.get("e")) + 86_400), p.get("s"), now)).isEmpty();
        assertThat(images.verify(p.get("u"), p.get("e"), "x" + p.get("s").substring(1), now)).isEmpty();
        assertThat(images.verify(p.get("u"), "not-a-number", p.get("s"), now)).isEmpty();
        assertThat(images.verify(null, null, null, now)).isEmpty();
        byte[] otherKey = new byte[32];
        otherKey[0] = 1;
        assertThat(new ReadingImages(otherKey).verify(p.get("u"), p.get("e"), p.get("s"), now)).isEmpty();
    }
}
