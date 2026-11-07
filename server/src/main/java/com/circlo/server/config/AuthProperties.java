package com.circlo.server.config;

import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Auth timings under {@code circlo.auth.*}. */
@ConfigurationProperties("circlo.auth")
public record AuthProperties(
        Duration accessTtl,
        Duration refreshTtl,
        Duration codeTtl,
        Duration pendingSignupTtl,
        Integer ipRequestsPerMinute,
        Boolean loginCodeForOldApps,
        List<String> loginCodeExempt) {

    public AuthProperties {
        accessTtl = accessTtl == null ? Duration.ofMinutes(15) : accessTtl;
        refreshTtl = refreshTtl == null ? Duration.ofDays(30) : refreshTtl;
        codeTtl = codeTtl == null ? Duration.ofMinutes(15) : codeTtl;
        pendingSignupTtl = pendingSignupTtl == null ? Duration.ofDays(1) : pendingSignupTtl;
        ipRequestsPerMinute = ipRequestsPerMinute == null ? 30 : ipRequestsPerMinute;
        // Apps already in the stores sign in with the password alone until this is on (then by their "Check your
        // email" screen); newer apps always ask for the code (owner decision 2026-11-07).
        loginCodeForOldApps = loginCodeForOldApps != null && loginCodeForOldApps;
        loginCodeExempt = loginCodeExempt == null ? List.of() : loginCodeExempt;
    }

    /**
     * App review accounts that sign in with the password alone (CIRCLO_LOGIN_CODE_EXEMPT, owner decision 2026-11-08):
     * Apple's and Google's reviewers can't read the account's email for the code. Usernames, any case.
     */
    public Set<String> exemptUsernames() {
        return loginCodeExempt.stream().map(s -> s.trim().toLowerCase(Locale.ROOT)).filter(s -> !s.isEmpty()).collect(Collectors.toSet());
    }
}
