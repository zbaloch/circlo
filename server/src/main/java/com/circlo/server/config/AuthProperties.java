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
        Integer ipRequestsPerMinute,
        Boolean loginCodeForOldApps) {

    public AuthProperties {
        accessTtl = accessTtl == null ? Duration.ofMinutes(15) : accessTtl;
        refreshTtl = refreshTtl == null ? Duration.ofDays(30) : refreshTtl;
        codeTtl = codeTtl == null ? Duration.ofMinutes(15) : codeTtl;
        pendingSignupTtl = pendingSignupTtl == null ? Duration.ofDays(1) : pendingSignupTtl;
        ipRequestsPerMinute = ipRequestsPerMinute == null ? 30 : ipRequestsPerMinute;
        // Apps already in the stores sign in with the password alone until this is on (then by their "Check your
        // email" screen); newer apps always ask for the code (owner decision 2026-11-07).
        loginCodeForOldApps = loginCodeForOldApps != null && loginCodeForOldApps;
    }
}
