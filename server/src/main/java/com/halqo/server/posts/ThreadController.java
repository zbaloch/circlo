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

    public ThreadController(JdbcTemplate jdbc, PostAccess access, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.access = access;
        this.limiter = limiter;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(UUID.fromString(jwt.getSubject()));
    }

    /** The post's author, if I may read it; otherwise 404 (indistinguishable from a missing post). */
    private byte[] readableAuthor(byte[] me, UUID postId) {
        byte[] author = access.authorOf(Ids.bytes(postId)).orElseThrow(ApiException::notFound);
        if (!access.canRead(me, author)) {
            throw ApiException.notFound();
        }
        return author;
    }

    // ---------- replies ----------

    public record NewReply(@NotNull UUID replyId, @NotNull @Size(min = 32, max = MAX_REPLY_CT) byte[] ciphertext) {}

    public record ReplyView(UUID replyId, UUID authorId, byte[] ciphertext, Instant createdAt) {}

    @PostMapping("/v1/posts/{postId}/replies")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> reply(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId, @Valid @RequestBody NewReply r) {
        byte[] me = me(jwt);
        readableAuthor(me, postId);
        if (!limiter.tryAcquire("replies", me, 120, 60_000)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited");
        }
        jdbc.update("INSERT INTO post_replies (id, post_id, author_id, ciphertext, created_at) VALUES (?, ?, ?, ?, ?)",
                Ids.bytes(r.replyId()), Ids.bytes(postId), me, r.ciphertext(), Timestamp.from(Instant.now()));
        return Map.of("replyId", r.replyId());
    }

    @GetMapping("/v1/posts/{postId}/replies")
    public List<ReplyView> replies(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId,
            @RequestParam(value = "after", required = false) Instant after,
            @RequestParam(value = "limit", defaultValue = "100") @Min(1) @Max(200) int limit) {
        readableAuthor(me(jwt), postId);
        return jdbc.query(
                "SELECT id, author_id, ciphertext, created_at FROM post_replies WHERE post_id = ? AND created_at > ? ORDER BY created_at, id LIMIT ?",
                (rs, i) -> new ReplyView(Ids.uuid(rs.getBytes(1)), Ids.uuid(rs.getBytes(2)), rs.getBytes(3), rs.getTimestamp(4).toInstant()),
                Ids.bytes(postId), Timestamp.from(after == null ? Instant.EPOCH : after), Math.min(limit, 200));
    }

    /** The reply's author, or the post's author, may delete it. */
    @DeleteMapping("/v1/posts/{postId}/replies/{replyId}")
    @Transactional
    public Map<String, String> deleteReply(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId,
            @PathVariable("replyId") UUID replyId) {
        byte[] me = me(jwt);
        byte[] author = readableAuthor(me, postId);
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
    public Map<String, String> like(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId) {
        byte[] me = me(jwt);
        readableAuthor(me, postId);
        jdbc.update("INSERT IGNORE INTO post_likes (post_id, liker_id, created_at) VALUES (?, ?, ?)", Ids.bytes(postId), me,
                Timestamp.from(Instant.now()));
        return Map.of("status", "liked");
    }

    @DeleteMapping("/v1/posts/{postId}/like")
    public Map<String, String> unlike(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId) {
        byte[] me = me(jwt);
        readableAuthor(me, postId);
        jdbc.update("DELETE FROM post_likes WHERE post_id = ? AND liker_id = ?", Ids.bytes(postId), me);
        return Map.of("status", "unliked");
    }

    public record LikeView(UUID userId, Instant createdAt) {}

    @GetMapping("/v1/posts/{postId}/likes")
    public List<LikeView> likes(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId) {
        readableAuthor(me(jwt), postId);
        return jdbc.query("SELECT liker_id, created_at FROM post_likes WHERE post_id = ? ORDER BY created_at",
                (rs, i) -> new LikeView(Ids.uuid(rs.getBytes(1)), rs.getTimestamp(2).toInstant()), (Object) Ids.bytes(postId));
    }
}
