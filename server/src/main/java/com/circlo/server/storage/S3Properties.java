package com.circlo.server.storage;

import jakarta.validation.constraints.NotBlank;
import java.net.URI;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * S3/MinIO settings under {@code circlo.s3.*}.
 *
 * @param publicEndpoint the address presigned URLs are signed for; must be reachable from phones
 *                       (http://${LAN_IP}:9000 in dev), never localhost
 */
@Validated
@ConfigurationProperties("circlo.s3")
public record S3Properties(
        @NotBlank String bucket,
        URI publicEndpoint,
        @NotBlank String region,
        @NotBlank String accessKey,
        @NotBlank String secretKey,
        Duration putTtl,
        Duration getTtl) {

    public S3Properties {
        if (publicEndpoint == null) {
            throw new IllegalArgumentException("circlo.s3.public-endpoint is required");
        }
        putTtl = putTtl == null ? Duration.ofMinutes(15) : putTtl;
        getTtl = getTtl == null ? Duration.ofMinutes(5) : getTtl;
    }
}
