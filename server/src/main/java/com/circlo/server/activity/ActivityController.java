package com.circlo.server.activity;

import com.circlo.server.auth.TokenService;
import com.circlo.server.posts.PostAccess;
import com.circlo.server.social.People;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import com.circlo.server.web.RateLimiter;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Activity without remote push (owner decision 2026-10-30): Apple and Google never learn when someone gets activity.
 * The Notifications tab lists replies and likes on my posts. A phone that opts in to background checks holds a
 * per-device check token that reads nothing but counts since a time; it is stored only as a hash, replaced when a new
 * one is issued, and dies with the device.
 */
@RestController
public class ActivityController {

    public static final String CHECK_TOKEN = "X-Circlo-Check-Token";

    private final JdbcTemplate jdbc;
    private final RateLimiter limiter;
    private final People people;

    public ActivityController(JdbcTemplate jdbc, RateLimiter limiter, People people) {
        this.jdbc = jdbc;
        this.limiter = limiter;
        this.people = people;
    }

    // ---------- the Notifications tab ----------

    public record Item(String kind, UUID postId, String postText, UUID actorId, People.Person actor, UUID replyId, String replyText,
            Instant createdAt) {}

    public record Activity(List<Item> items) {}

    /**
     * Replies and likes by other people on my posts, and likes on my replies (on posts I can still see), newest first;
     * people I blocked are left out.
     */
    @GetMapping("/v1/activity")
    public Activity activity(@AuthenticationPrincipal Jwt jwt, @RequestParam(value = "before", required = false) Instant before,
            @RequestParam(value = "limit", defaultValue = "50") int limit) {
        byte[] me = Ids.bytes(TokenService.userOf(jwt));
        Timestamp cursor = Timestamp.from(before == null ? Instant.now().plusSeconds(60) : before);
        int n = Math.max(1, Math.min(limit, 100));
        record Row(String kind, UUID post, String postText, UUID actor, UUID reply, String replyText, Instant at) {}
        List<Row> rows = jdbc.query("""
                SELECT * FROM (
                  SELECT 'reply' AS kind, r.post_id, p.body AS post_body, r.author_id AS actor, r.id AS reply_id, r.body AS reply_body, r.created_at
                    FROM post_replies r JOIN posts p ON p.id = r.post_id
                   WHERE p.author_id = ? AND r.author_id <> ? AND r.created_at < ?
                  UNION ALL
                  SELECT 'like', l.post_id, p.body, l.liker_id, NULL, NULL, l.created_at
                    FROM post_likes l JOIN posts p ON p.id = l.post_id
                   WHERE p.author_id = ? AND l.liker_id <> ? AND l.created_at < ?
                  UNION ALL
                  SELECT 'reply_like', r.post_id, p.body, rl.liker_id, r.id, r.body, rl.created_at
                    FROM reply_likes rl JOIN post_replies r ON r.id = rl.reply_id JOIN posts p ON p.id = r.post_id
                   WHERE r.author_id = ? AND rl.liker_id <> ? AND rl.created_at < ? AND """ + PostAccess.VISIBLE + """
                ) a
                WHERE a.actor NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
                ORDER BY a.created_at DESC LIMIT ?""",
                (rs, i) -> new Row(rs.getString(1), Ids.uuid(rs.getBytes(2)), rs.getString(3), Ids.uuid(rs.getBytes(4)),
                        rs.getBytes(5) == null ? null : Ids.uuid(rs.getBytes(5)), rs.getString(6), rs.getTimestamp(7).toInstant()),
                me, me, cursor, me, me, cursor, me, me, cursor, me, me, me, me, me, n);
        Map<UUID, People.Person> actors = people.persons(rows.stream().map(Row::actor).toList());
        return new Activity(rows.stream().filter(r -> actors.containsKey(r.actor()))
                .map(r -> new Item(r.kind(), r.post(), r.postText(), r.actor(), actors.get(r.actor()), r.reply(), r.replyText(), r.at()))
                .toList());
    }

    // ---------- background checks ----------

    public record CheckToken(String token) {}

    /** Turns on background checks for this device; any earlier token for it stops working. */
    @PostMapping("/v1/devices/current/check-token")
    public CheckToken issue(@AuthenticationPrincipal Jwt jwt) {
        byte[] raw = Ids.random(32);
        if (jdbc.update("UPDATE devices SET check_token_hash = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
                TokenService.sha256(raw), Ids.bytes(TokenService.deviceOf(jwt)), Ids.bytes(TokenService.userOf(jwt))) != 1) {
            throw ApiException.notFound();
        }
        return new CheckToken(Base64.getUrlEncoder().withoutPadding().encodeToString(raw));
    }

    @DeleteMapping("/v1/devices/current/check-token")
    public Map<String, String> stop(@AuthenticationPrincipal Jwt jwt) {
        jdbc.update("UPDATE devices SET check_token_hash = NULL WHERE id = ? AND user_id = ?", Ids.bytes(TokenService.deviceOf(jwt)),
                Ids.bytes(TokenService.userOf(jwt)));
        return Map.of("status", "stopped");
    }

    public record Pending(int requests, int replies, int likes, int messages, int signIns) {}

    /**
     * Counts of new activity since `since`, for the device holding the check token (no session needed, so it works
     * while the phone is locked). People I blocked are left out.
     */
    @GetMapping("/v1/activity/pending")
    public Pending pending(@RequestHeader(value = CHECK_TOKEN, required = false) String checkToken, @RequestParam("since") Instant since) {
        if (checkToken == null || checkToken.isEmpty()) {
            throw ApiException.unauthorized();
        }
        byte[] hash;
        try {
            hash = TokenService.sha256(Base64.getUrlDecoder().decode(checkToken));
        } catch (IllegalArgumentException e) {
            throw ApiException.unauthorized();
        }
        List<byte[][]> rows = jdbc.query("SELECT id, user_id FROM devices WHERE check_token_hash = ? AND revoked_at IS NULL",
                (rs, i) -> new byte[][] {rs.getBytes(1), rs.getBytes(2)}, (Object) hash);
        if (rows.isEmpty()) {
            throw ApiException.unauthorized();
        }
        byte[] device = rows.get(0)[0];
        byte[] me = rows.get(0)[1];
        if (!limiter.tryAcquire("activity-check", device, 30, 3_600_000)) {
            throw ApiException.rateLimited();
        }
        Timestamp t = Timestamp.from(since);
        String notBlocked = " NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)";
        return new Pending(
                count("SELECT COUNT(*) FROM friendships WHERE user_b = ? AND status = 'pending' AND created_at > ? AND user_a" + notBlocked, me, t, me),
                count("SELECT COUNT(*) FROM post_replies r JOIN posts p ON p.id = r.post_id WHERE p.author_id = ? AND r.author_id <> ? "
                        + "AND r.created_at > ? AND r.author_id" + notBlocked, me, me, t, me),
                count("SELECT COUNT(*) FROM post_likes l JOIN posts p ON p.id = l.post_id WHERE p.author_id = ? AND l.liker_id <> ? "
                        + "AND l.created_at > ? AND l.liker_id" + notBlocked, me, me, t, me),
                count("SELECT COUNT(*) FROM chat_messages m JOIN chat_members c ON c.chat_id = m.chat_id AND c.user_id = ? "
                        + "WHERE m.sender_id <> ? AND m.seq > c.read_seq AND m.created_at > ? AND m.sender_id" + notBlocked, me, me, t, me),
                count("SELECT COUNT(*) FROM security_events WHERE user_id = ? AND created_at > ?", me, t));
    }

    private int count(String sql, Object... args) {
        Integer n = jdbc.queryForObject(sql, Integer.class, args);
        return n == null ? 0 : n;
    }
}
