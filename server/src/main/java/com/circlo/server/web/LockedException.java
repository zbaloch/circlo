package com.circlo.server.web;

import org.springframework.http.HttpStatus;

/** Password login is locked for this handle (auth.LoginThrottle); `retryAfterSeconds` says when it opens again. */
public class LockedException extends ApiException {

    private final long retryAfterSeconds;

    public LockedException(long retryAfterSeconds) {
        super(HttpStatus.TOO_MANY_REQUESTS, "locked");
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public long retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
