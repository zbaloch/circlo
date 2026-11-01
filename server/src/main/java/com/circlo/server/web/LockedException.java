package com.circlo.server.web;

import java.util.Map;
import org.springframework.http.HttpStatus;

/** Login is locked for this account (auth.LoginThrottle); `retryAfterSeconds` says when it opens again. */
public class LockedException extends ApiException {

    private final long retryAfterSeconds;

    public LockedException(long retryAfterSeconds) {
        super(HttpStatus.TOO_MANY_REQUESTS, "locked", Map.of("retryAfter", retryAfterSeconds));
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public long retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
