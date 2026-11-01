package com.circlo.server.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Auth timings under {@code circlo.auth.*}. */
@ConfigurationProperties("circlo.auth")
public record AuthProperties(
        Duration accessTtl,
        Duration refreshTtl,
        Duration codeTtl,
        Duration pendingSignupTtl,
        Integer ipRequestsPerMinute) {

    public AuthProperties {
        accessTtl = accessTtl == null ? Duration.ofMinutes(15) : accessTtl;
        refreshTtl = refreshTtl == null ? Duration.ofDays(30) : refreshTtl;
        codeTtl = codeTtl == null ? Duration.ofMinutes(15) : codeTtl;
        pendingSignupTtl = pendingSignupTtl == null ? Duration.ofDays(1) : pendingSignupTtl;
        ipRequestsPerMinute = ipRequestsPerMinute == null ? 30 : ipRequestsPerMinute;
    }
}
