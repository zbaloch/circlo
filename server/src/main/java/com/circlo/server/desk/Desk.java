package com.circlo.server.desk;

import com.circlo.server.auth.TokenService;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import com.circlo.server.web.RateLimiter;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * Shared by the Desk controllers (owner decision 2026-11-14). The Desk is a personal space: every row belongs to one
 * person and every query is scoped to `owner_id = me`, so anything that isn't mine is simply not found (404), never
 * "forbidden". Nothing in it is ever shown to anyone else.
 */
final class Desk {

    private Desk() {}

    static byte[] me(Jwt jwt) {
        return Ids.bytes(TokenService.userOf(jwt));
    }

    static Timestamp now() {
        return Timestamp.from(Instant.now());
    }

    static UUID uuid(byte[] b) {
        return b == null ? null : Ids.uuid(b);
    }

    static byte[] bytes(UUID id) {
        return id == null ? null : Ids.bytes(id);
    }

    /** Creating things: generous for real use, a stop for scripts filling the database. */
    static void limitWrites(RateLimiter limiter, byte[] me) {
        if (!limiter.tryAcquire("desk", me, 240, 60_000)) {
            throw ApiException.rateLimited();
        }
    }

    /** Trimmed text of at most `max` characters; empty is allowed only if `required` is false. */
    static String text(String raw, int max, boolean required, String error) {
        String s = raw == null ? "" : raw.strip();
        if ((required && s.isEmpty()) || s.codePointCount(0, s.length()) > max) {
            throw ApiException.badRequest(error);
        }
        return s;
    }

    /** A name for a list or folder (up to 100 characters) or file (200): one line. */
    static String name(String raw, int max) {
        String s = text(raw, max, true, "invalid_name");
        if (s.contains("\n") || s.contains("\r")) {
            throw ApiException.badRequest("invalid_name");
        }
        return s;
    }
}
