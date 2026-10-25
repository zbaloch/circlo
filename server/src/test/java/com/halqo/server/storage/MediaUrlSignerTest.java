package com.halqo.server.storage;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.URL;
import java.time.Duration;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

class MediaUrlSignerTest {

    private static final S3Properties PROPS = new S3Properties(
            "halqo-media-test",
            URI.create("http://192.0.2.10:9000"),
            "us-east-1",
            "test-only-not-a-secret",
            "test-only-not-a-secret",
            Duration.ofMinutes(15),
            Duration.ofMinutes(5));

    private final MediaUrlSigner signer = new MediaUrlSigner(new S3Config().s3Presigner(PROPS), PROPS);

    @Test
    void putUrlIsPathStyleOnPublicEndpointWith15MinuteExpiry() {
        URL url = signer.presignPut("abc123");

        assertThat(url.toString()).startsWith("http://192.0.2.10:9000/halqo-media-test/abc123?");
        assertThat(url.getQuery()).contains("X-Amz-Expires=900");
    }

    @Test
    void getUrlExpiresIn5Minutes() {
        URL url = signer.presignGet("abc123");

        assertThat(url.toString()).startsWith("http://192.0.2.10:9000/halqo-media-test/abc123?");
        assertThat(url.getQuery()).contains("X-Amz-Expires=300");
    }

    @Test
    void objectKeysAreRandom256BitHex() {
        Set<String> keys = new HashSet<>();
        for (int i = 0; i < 1000; i++) {
            String key = MediaUrlSigner.newObjectKey();
            assertThat(key).matches("[0-9a-f]{64}");
            keys.add(key);
        }
        assertThat(keys).hasSize(1000);
    }
}
