package com.halqo.server.posts;

import com.halqo.server.web.ApiException;
import com.halqo.server.web.Ids;
import com.halqo.server.web.RateLimiter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.sql.Timestamp;
import java.time.Instant;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Replies and likes (PLAN.md Phase 8). Reply bodies are sealed by the client under a key derived from the post key,
 * so only people who can read the post can read them; the server stores ciphertext and checks only that the caller
 * may read the author's posts at all (author or accepted friend).
 */
@RestController
public class ThreadController {

    static final int MAX_REPLY_CT = 8192;

    private final JdbcTemplate jdbc;
    private final PostAccess access;
    private final RateLimiter limiter;
    private final com.halqo.server.push.PushService push;

    public ThreadController(JdbcTemplate jdbc, PostAccess access, RateLimiter limiter, com.halqo.server.push.PushService push) {
        this.jdbc = jdbc;
        this.access = access;
        this.limiter = limiter;
        this.push = push;
    }

    private void notifyAuthor(byte[] me, byte[] author) {
        if (!java.util.Arrays.equals(me, author)) {
            push.notifyUser(author);
        }
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(UUID.fromString(jwt.getSubject()));
    }

    static final String READ_TOKEN = "X-Halqo-Read-Token";

    /** The post's author, if I'm in its audience (read token checked); otherwise 404, like a missing post. */
    private byte[] readableAuthor(byte[] me, UUID postId, String readTokenHeader) {
        byte[] post = Ids.bytes(postId);
        if (!access.inAudience(me, post, PostAccess.tokenFromHeader(readTokenHeader))) {
            throw ApiException.notFound();
        }
        return access.authorOf(post).orElseThrow(ApiException::notFound);
    }

    // ---------- replies ----------

    public record NewReply(@NotNull UUID replyId, @NotNull @Size(min = 32, max = MAX_REPLY_CT) byte[] ciphertext) {}

    public record ReplyView(UUID replyId, UUID authorId, byte[] ciphertext, Instant createdAt) {}

    @PostMapping("/v1/posts/{postId}/replies")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> reply(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId,
            @RequestHeader(value = READ_TOKEN, required = false) String readToken, @Valid @RequestBody NewReply r) {
        byte[] me = me(jwt);
        byte[] author = readableAuthor(me, postId, readToken);
        if (!limiter.tryAcquire("replies", me, 120, 60_000)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited");
        }
        jdbc.update("INSERT INTO post_replies (id, post_id, author_id, ciphertext, created_at) VALUES (?, ?, ?, ?, ?)",
                Ids.bytes(r.replyId()), Ids.bytes(postId), me, r.ciphertext(), Timestamp.from(Instant.now()));
        notifyAuthor(me, author);
        return Map.of("replyId", r.replyId());
    }

    @GetMapping("/v1/posts/{postId}/replies")
    public List<ReplyView> replies(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId,
            @RequestHeader(value = READ_TOKEN, required = false) String readToken,
            @RequestParam(value = "after", required = false) Instant after,
            @RequestParam(value = "limit", defaultValue = "100") @Min(1) @Max(200) int limit) {
        readableAuthor(me(jwt), postId, readToken);
        return jdbc.query(
                "SELECT id, author_id, ciphertext, created_at FROM post_replies WHERE post_id = ? AND created_at > ? ORDER BY created_at, id LIMIT ?",
                (rs, i) -> new ReplyView(Ids.uuid(rs.getBytes(1)), Ids.uuid(rs.getBytes(2)), rs.getBytes(3), rs.getTimestamp(4).toInstant()),
                Ids.bytes(postId), Timestamp.from(after == null ? Instant.EPOCH : after), Math.min(limit, 200));
    }

    /** The reply's author, or the post's author, may delete it. */
    @DeleteMapping("/v1/posts/{postId}/replies/{replyId}")
    @Transactional
    public Map<String, String> deleteReply(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId,
            @PathVariable("replyId") UUID replyId, @RequestHeader(value = READ_TOKEN, required = false) String readToken) {
        byte[] me = me(jwt);
        byte[] author = readableAuthor(me, postId, readToken);
        int n = java.util.Arrays.equals(me, author)
                ? jdbc.update("DELETE FROM post_replies WHERE id = ? AND post_id = ?", Ids.bytes(replyId), Ids.bytes(postId))
                : jdbc.update("DELETE FROM post_replies WHERE id = ? AND post_id = ? AND author_id = ?", Ids.bytes(replyId), Ids.bytes(postId), me);
        if (n != 1) {
            throw ApiException.notFound();
        }
        return Map.of("status", "deleted");
    }

    // ---------- likes ----------

    @PutMapping("/v1/posts/{postId}/like")
    public Map<String, String> like(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId,
            @RequestHeader(value = READ_TOKEN, required = false) String readToken) {
        byte[] me = me(jwt);
        byte[] author = readableAuthor(me, postId, readToken);
        int added = jdbc.update("INSERT IGNORE INTO post_likes (post_id, liker_id, created_at) VALUES (?, ?, ?)", Ids.bytes(postId), me,
                Timestamp.from(Instant.now()));
        if (added == 1) {
            notifyAuthor(me, author);
        }
        return Map.of("status", "liked");
    }

    @DeleteMapping("/v1/posts/{postId}/like")
    public Map<String, String> unlike(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId,
            @RequestHeader(value = READ_TOKEN, required = false) String readToken) {
        byte[] me = me(jwt);
        readableAuthor(me, postId, readToken);
        jdbc.update("DELETE FROM post_likes WHERE post_id = ? AND liker_id = ?", Ids.bytes(postId), me);
        return Map.of("status", "unliked");
    }

    public record LikeView(UUID userId, Instant createdAt) {}

    @GetMapping("/v1/posts/{postId}/likes")
    public List<LikeView> likes(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId,
            @RequestHeader(value = READ_TOKEN, required = false) String readToken) {
        readableAuthor(me(jwt), postId, readToken);
        return jdbc.query("SELECT liker_id, created_at FROM post_likes WHERE post_id = ? ORDER BY created_at",
                (rs, i) -> new LikeView(Ids.uuid(rs.getBytes(1)), rs.getTimestamp(2).toInstant()), (Object) Ids.bytes(postId));
    }

    public record StatsItem(@NotNull UUID postId, @NotNull @Size(min = 32, max = 32) byte[] readToken) {}

    public record StatsRequest(@NotNull @Size(max = 200) List<@Valid StatsItem> items) {}

    public record PostStats(UUID postId, int replyCount, int likeCount, boolean likedByMe) {}

    /** Counts for posts I can prove I can read (one read token each); others are silently left out. Five queries per batch. */
    @PostMapping("/v1/posts/stats")
    public List<PostStats> stats(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody StatsRequest r) {
        byte[] me = me(jwt);
        Map<UUID, byte[]> tokens = new java.util.LinkedHashMap<>();
        r.items().forEach(i -> tokens.putIfAbsent(i.postId(), i.readToken()));
        List<UUID> allowed = tokens.keySet().stream().filter(access.inAudience(me, tokens)::contains).toList();
        if (allowed.isEmpty()) {
            return List.of();
        }
        String marks = String.join(",", java.util.Collections.nCopies(allowed.size(), "?"));
        Object[] ids = allowed.stream().map(Ids::bytes).toArray();
        Map<UUID, Integer> replies = counts("SELECT post_id, COUNT(*) FROM post_replies WHERE post_id IN (" + marks + ") GROUP BY post_id", ids);
        Map<UUID, Integer> likes = counts("SELECT post_id, COUNT(*) FROM post_likes WHERE post_id IN (" + marks + ") GROUP BY post_id", ids);
        Object[] mine = new Object[ids.length + 1];
        mine[0] = me;
        System.arraycopy(ids, 0, mine, 1, ids.length);
        java.util.Set<UUID> liked = new java.util.HashSet<>(jdbc.query("SELECT post_id FROM post_likes WHERE liker_id = ? AND post_id IN (" + marks + ")",
                (rs, i) -> Ids.uuid(rs.getBytes(1)), mine));
        return allowed.stream().map(id -> new PostStats(id, replies.getOrDefault(id, 0), likes.getOrDefault(id, 0), liked.contains(id))).toList();
    }

    private Map<UUID, Integer> counts(String sql, Object[] ids) {
        Map<UUID, Integer> out = new java.util.HashMap<>();
        jdbc.query(sql, rs -> {
            out.put(Ids.uuid(rs.getBytes(1)), rs.getInt(2));
        }, ids);
        return out;
    }
}
