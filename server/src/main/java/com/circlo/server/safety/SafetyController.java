package com.circlo.server.safety;

import com.circlo.server.auth.TokenService;
import com.circlo.server.posts.PostAccess;
import com.circlo.server.social.People;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import com.circlo.server.web.RateLimiter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Blocking and reporting (Apple guideline 1.2, Google Play's UGC policy). A report keeps a copy of what was reported,
 * made by the server from what the reporter could see, so deleting it afterwards doesn't erase the evidence.
 */
@RestController
public class SafetyController {

    private final JdbcTemplate jdbc;
    private final People people;
    private final PostAccess access;
    private final RateLimiter limiter;

    public SafetyController(JdbcTemplate jdbc, People people, PostAccess access, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.people = people;
        this.access = access;
        this.limiter = limiter;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(TokenService.userOf(jwt));
    }

    // ---------- reports ----------

    public record NewReport(@NotNull @Pattern(regexp = "post|user|message|reply") String kind, @NotNull UUID targetId,
            @NotNull @Pattern(regexp = "[a-z_]{1,32}") String reason, @Size(max = 1000) String note) {}

    @PostMapping("/v1/reports")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Map<String, String> report(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody NewReport r) {
        byte[] me = me(jwt);
        if (!limiter.tryAcquire("reports", me, 20, 3_600_000)) {
            throw ApiException.rateLimited();
        }
        byte[] target = Ids.bytes(r.targetId());
        Object[] subject = switch (r.kind()) {
            case "post" -> {
                if (!access.canSee(me, target)) {
                    throw ApiException.notFound();
                }
                yield jdbc.queryForObject("SELECT author_id, CONCAT('post: ', body) FROM posts WHERE id = ?",
                        (rs, i) -> new Object[] {rs.getBytes(1), rs.getString(2)}, (Object) target);
            }
            case "user" -> {
                if (people.relation(me, target) == null && !people.blockedEitherWay(me, target)) {
                    throw ApiException.notFound();
                }
                yield jdbc.query("SELECT id, CONCAT('user: ', COALESCE(name, username), ' @', username, '\\n', bio) FROM users WHERE id = ?",
                        (rs, i) -> new Object[] {rs.getBytes(1), rs.getString(2)}, (Object) target).stream().findFirst()
                        .orElseThrow(ApiException::notFound);
            }
            case "reply" -> {
                Object[] row = jdbc.query("SELECT post_id, author_id, CONCAT('reply: ', body) FROM post_replies WHERE id = ?",
                        (rs, i) -> new Object[] {rs.getBytes(1), rs.getBytes(2), rs.getString(3)}, (Object) target).stream().findFirst()
                        .orElseThrow(ApiException::notFound);
                if (!access.canSee(me, (byte[]) row[0])) {
                    throw ApiException.notFound();
                }
                yield new Object[] {row[1], row[2]};
            }
            default -> jdbc.query("""
                    SELECT m.sender_id, CONCAT('message: ', m.body) FROM chat_messages m
                    JOIN chat_members c ON c.chat_id = m.chat_id AND c.user_id = ? WHERE m.id = ?""",
                    (rs, i) -> new Object[] {rs.getBytes(1), rs.getString(2)}, me, target).stream().findFirst()
                    .orElseThrow(ApiException::notFound);
        };
        jdbc.update("INSERT INTO reports (id, reporter_id, target_kind, target_id, target_user, reason, note, snapshot, created_at) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                Ids.bytes(Ids.newId()), me, r.kind(), target, subject[0], r.reason(), r.note() == null ? "" : r.note().strip(), subject[1],
                Timestamp.from(Instant.now()));
        return Map.of("status", "received");
    }

    // ---------- blocks ----------

    /** Blocks someone: we stop being connected, and neither of us can send requests or redeem the other's invites. */
    @PostMapping("/v1/blocks/{userId}")
    @Transactional
    public Map<String, String> block(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId) {
        byte[] me = me(jwt);
        byte[] other = Ids.bytes(userId);
        if (Arrays.equals(me, other) || jdbc.queryForList("SELECT 1 FROM users WHERE id = ?", (Object) other).isEmpty()) {
            throw ApiException.notFound();
        }
        jdbc.update("INSERT IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)", me, other, Timestamp.from(Instant.now()));
        people.disconnect(me, other);
        return Map.of("status", "blocked");
    }

    @DeleteMapping("/v1/blocks/{userId}")
    public Map<String, String> unblock(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId) {
        jdbc.update("DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?", me(jwt), Ids.bytes(userId));
        return Map.of("status", "unblocked");
    }

    public record BlockView(UUID userId, String name, String username, Instant createdAt) {}

    @GetMapping("/v1/blocks")
    public List<BlockView> blocks(@AuthenticationPrincipal Jwt jwt) {
        return jdbc.query("""
                SELECT b.blocked_id, COALESCE(u.name, u.username) AS name, u.username, b.created_at FROM user_blocks b JOIN users u ON u.id = b.blocked_id
                WHERE b.blocker_id = ? ORDER BY b.created_at DESC""",
                (rs, i) -> new BlockView(Ids.uuid(rs.getBytes(1)), rs.getString(2), rs.getString(3), rs.getTimestamp(4).toInstant()),
                (Object) me(jwt));
    }
}
