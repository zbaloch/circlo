package com.halqo.server.storage;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.SecureRandom;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

/** Round-trips bytes through MinIO using only presigned URLs on the public endpoint (halqo-media-test). */
@SpringBootTest(classes = {S3Config.class, MediaUrlSigner.class})
@EnableConfigurationProperties(S3Properties.class)
@ActiveProfiles("test")
class PresignedUploadIT {

    @Autowired
    private MediaUrlSigner signer;

    @Autowired
    private S3Properties props;

    private final HttpClient http = HttpClient.newHttpClient();

    @Test
    void presignedPutThenGetRoundTrips() throws Exception {
        assertThat(props.bucket()).isEqualTo("halqo-media-test");

        byte[] body = new byte[70_000];
        new SecureRandom().nextBytes(body);
        String key = MediaUrlSigner.newObjectKey();

        HttpResponse<Void> put = http.send(
                HttpRequest.newBuilder(signer.presignPut(key).toURI())
                        .PUT(HttpRequest.BodyPublishers.ofByteArray(body))
                        .build(),
                HttpResponse.BodyHandlers.discarding());
        assertThat(put.statusCode()).isEqualTo(200);

        HttpResponse<byte[]> get = http.send(
                HttpRequest.newBuilder(signer.presignGet(key).toURI()).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray());
        assertThat(get.statusCode()).isEqualTo(200);
        assertThat(get.body()).isEqualTo(body);
    }

    @Test
    void unsignedAccessIsRefused() throws Exception {
        URI plain = URI.create(props.publicEndpoint() + "/" + props.bucket() + "/" + MediaUrlSigner.newObjectKey());

        HttpResponse<Void> get = http.send(HttpRequest.newBuilder(plain).GET().build(),
                HttpResponse.BodyHandlers.discarding());
        assertThat(get.statusCode()).isEqualTo(403);
    }
}
