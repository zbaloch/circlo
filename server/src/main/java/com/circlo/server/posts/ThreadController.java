package com.circlo.server.posts;

import com.circlo.server.auth.TokenService;
import com.circlo.server.social.People;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import com.circlo.server.web.RateLimiter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Replies and likes. Anyone who can see a post can see and add its replies and likes, and nobody else; replies from
 * people I blocked are left out for me.
 */
@RestController
public class ThreadController {

    static final int MAX_REPLY_CHARS = 500;

    private final JdbcTemplate jdbc;
    private final PostAccess access;
    private final People people;
    private final RateLimiter limiter;

    public ThreadController(JdbcTemplate jdbc, PostAccess access, People people, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.access = access;
        this.people = people;
        this.limiter = limiter;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(TokenService.userOf(jwt));
    }

    private byte[] visibleAuthor(byte[] me, UUID postId) {
        return access.visibleAuthor(me, postId).orElseThrow(ApiException::notFound);
    }

    // ---------- replies ----------

    public record NewReply(@NotNull @Size(max = 4 * MAX_REPLY_CHARS) String text) {}

    public record ReplyView(UUID replyId, UUID authorId, People.Person author, String text, Instant createdAt) {}

    @PostMapping("/v1/posts/{postId}/replies")
    @ResponseStatus(HttpStatus.CREATED)
    public ReplyView reply(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId, @Valid @RequestBody NewReply r) {
        byte[] me = me(jwt);
        visibleAuthor(me, postId);
        if (!limiter.tryAcquire("replies", me, 120, 60_000)) {
            throw ApiException.rateLimited();
        }
        String text = PostController.cleanText(r.text(), MAX_REPLY_CHARS, false);
        UUID replyId = Ids.newId();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO post_replies (id, post_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
                Ids.bytes(replyId), Ids.bytes(postId), me, text, Timestamp.from(now));
        UUID author = Ids.uuid(me);
        return new ReplyView(replyId, author, people.person(author), text, now);
    }

    @GetMapping("/v1/posts/{postId}/replies")
    public List<ReplyView> replies(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId,
            @RequestParam(value = "after", required = false) Instant after,
            @RequestParam(value = "limit", defaultValue = "100") int limit) {
        byte[] me = me(jwt);
        visibleAuthor(me, postId);
        record Row(UUID id, UUID author, String body, Instant at) {}
        List<Row> rows = jdbc.query("""
                SELECT id, author_id, body, created_at FROM post_replies
                WHERE post_id = ? AND created_at > ? AND author_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)
                ORDER BY created_at, id LIMIT ?""",
                (rs, i) -> new Row(Ids.uuid(rs.getBytes(1)), Ids.uuid(rs.getBytes(2)), rs.getString(3), rs.getTimestamp(4).toInstant()),
                Ids.bytes(postId), Timestamp.from(after == null ? Instant.EPOCH : after), me, Math.max(1, Math.min(limit, 200)));
        Map<UUID, People.Person> authors = people.persons(rows.stream().map(Row::author).toList());
        return rows.stream().filter(r -> authors.containsKey(r.author()))
                .map(r -> new ReplyView(r.id(), r.author(), authors.get(r.author()), r.body(), r.at())).toList();
    }

    /** The reply's author, or the post's author, may delete it. */
    @DeleteMapping("/v1/posts/{postId}/replies/{replyId}")
    @Transactional
    public Map<String, String> deleteReply(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId,
            @PathVariable("replyId") UUID replyId) {
        byte[] me = me(jwt);
        byte[] author = visibleAuthor(me, postId);
        int n = Arrays.equals(me, author)
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
        visibleAuthor(me, postId);
        jdbc.update("INSERT IGNORE INTO post_likes (post_id, liker_id, created_at) VALUES (?, ?, ?)", Ids.bytes(postId), me,
                Timestamp.from(Instant.now()));
        return Map.of("status", "liked");
    }

    @DeleteMapping("/v1/posts/{postId}/like")
    public Map<String, String> unlike(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId) {
        byte[] me = me(jwt);
        visibleAuthor(me, postId);
        jdbc.update("DELETE FROM post_likes WHERE post_id = ? AND liker_id = ?", Ids.bytes(postId), me);
        return Map.of("status", "unliked");
    }

    @GetMapping("/v1/posts/{postId}/likes")
    public List<People.Person> likes(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId) {
        byte[] me = me(jwt);
        visibleAuthor(me, postId);
        List<UUID> ids = jdbc.query("SELECT liker_id FROM post_likes WHERE post_id = ? ORDER BY created_at",
                (rs, i) -> Ids.uuid(rs.getBytes(1)), (Object) Ids.bytes(postId));
        Map<UUID, People.Person> persons = people.persons(ids);
        return ids.stream().filter(persons::containsKey).map(persons::get).toList();
    }
}
