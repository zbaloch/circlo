package com.circlo.server.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Auth timings under {@code circlo.auth.*}. */
@ConfigurationProperties("circlo.auth")
public record AuthProperties(
        Duration accessTtl,
        Duration refreshTtl,
        Duration recoveryTtl,
        Duration challengeTtl,
        Duration pendingRegistrationTtl,
        Integer ipRequestsPerMinute) {

    public AuthProperties {
        accessTtl = accessTtl == null ? Duration.ofMinutes(15) : accessTtl;
        refreshTtl = refreshTtl == null ? Duration.ofDays(30) : refreshTtl;
        recoveryTtl = recoveryTtl == null ? Duration.ofMinutes(15) : recoveryTtl;
        challengeTtl = challengeTtl == null ? Duration.ofSeconds(60) : challengeTtl;
        pendingRegistrationTtl = pendingRegistrationTtl == null ? Duration.ofMinutes(30) : pendingRegistrationTtl;
        ipRequestsPerMinute = ipRequestsPerMinute == null ? 30 : ipRequestsPerMinute;
    }
}
