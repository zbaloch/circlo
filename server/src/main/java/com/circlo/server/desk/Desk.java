package com.circlo.server.desk;

import com.circlo.server.auth.TokenService;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import com.circlo.server.web.RateLimiter;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
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

    /** One line of required text (a board's name, a note's or file's title) of at most `max` characters. */
    static String line(String raw, int max, String error) {
        String s = text(raw, max, true, error);
        if (s.contains("\n") || s.contains("\r")) {
            throw ApiException.badRequest(error);
        }
        return s;
    }

    /** An optional description: trailing space dropped, at most `max` characters, "" when blank. */
    static String description(String raw, int max) {
        String s = raw == null ? "" : raw.stripTrailing();
        if (s.codePointCount(0, s.length()) > max) {
            throw ApiException.badRequest("invalid_description");
        }
        return s.isBlank() ? "" : s;
    }

    /** The name of one of my boards; 404 if it isn't mine. */
    static String board(JdbcTemplate jdbc, byte[] me, UUID boardId) {
        List<String> name = jdbc.queryForList("SELECT name FROM desk_boards WHERE id = ? AND owner_id = ?", String.class, bytes(boardId), me);
        if (name.isEmpty()) {
            throw ApiException.notFound();
        }
        return name.get(0);
    }
}
