package com.circlo.server.posts;

import com.circlo.server.auth.TokenService;
import com.circlo.server.notify.Notifier;
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
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
 * Replies and likes, on posts and on replies. Anyone who can see a post can see and add its replies and likes, and
 * nobody else; replies from people I blocked are left out for me. A person's replies are listed only on posts I can see.
 */
@RestController
public class ThreadController {

    static final int MAX_REPLY_CHARS = 500;

    private final JdbcTemplate jdbc;
    private final PostAccess access;
    private final People people;
    private final RateLimiter limiter;
    private final Notifier notifier;
    private final PostController posts;

    public ThreadController(JdbcTemplate jdbc, PostAccess access, People people, RateLimiter limiter, Notifier notifier, PostController posts) {
        this.jdbc = jdbc;
        this.access = access;
        this.people = people;
        this.limiter = limiter;
        this.notifier = notifier;
        this.posts = posts;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(TokenService.userOf(jwt));
    }

    private byte[] visibleAuthor(byte[] me, UUID postId) {
        return access.visibleAuthor(me, postId).orElseThrow(ApiException::notFound);
    }

    // ---------- replies ----------

    public record NewReply(@NotNull @Size(max = 4 * MAX_REPLY_CHARS) String text) {}

    public record ReplyView(UUID replyId, UUID authorId, People.Person author, String text, Instant createdAt, int likeCount,
            boolean likedByMe) {}

    private record ReplyRow(UUID id, UUID post, UUID author, String body, Instant at) {}

    private static final String REPLY_COLUMNS = "r.id, r.post_id, r.author_id, r.body, r.created_at";

    private static ReplyRow replyRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new ReplyRow(Ids.uuid(rs.getBytes(1)), Ids.uuid(rs.getBytes(2)), Ids.uuid(rs.getBytes(3)), rs.getString(4),
                rs.getTimestamp(5).toInstant());
    }

    /** Replies (already limited to what `viewer` may see) with their authors and likes, in the given order. */
    private List<ReplyView> replyViews(byte[] viewer, List<ReplyRow> rows) {
        if (rows.isEmpty()) {
            return List.of();
        }
        String marks = String.join(",", Collections.nCopies(rows.size(), "?"));
        Object[] ids = rows.stream().map(r -> Ids.bytes(r.id())).toArray();
        Map<UUID, Integer> likes = new HashMap<>();
        jdbc.query("SELECT reply_id, COUNT(*) FROM reply_likes WHERE reply_id IN (" + marks + ") GROUP BY reply_id",
                rs -> {
                    likes.put(Ids.uuid(rs.getBytes(1)), rs.getInt(2));
                }, ids);
        Object[] mineArgs = new Object[ids.length + 1];
        mineArgs[0] = viewer;
        System.arraycopy(ids, 0, mineArgs, 1, ids.length);
        Set<UUID> liked = new HashSet<>(jdbc.query("SELECT reply_id FROM reply_likes WHERE liker_id = ? AND reply_id IN (" + marks + ")",
                (rs, i) -> Ids.uuid(rs.getBytes(1)), mineArgs));
        Map<UUID, People.Person> authors = people.persons(rows.stream().map(ReplyRow::author).toList());
        return rows.stream().filter(r -> authors.containsKey(r.author()))
                .map(r -> new ReplyView(r.id(), r.author(), authors.get(r.author()), r.body(), r.at(), likes.getOrDefault(r.id(), 0),
                        liked.contains(r.id())))
                .toList();
    }

    @PostMapping("/v1/posts/{postId}/replies")
    @ResponseStatus(HttpStatus.CREATED)
    public ReplyView reply(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId, @Valid @RequestBody NewReply r) {
        byte[] me = me(jwt);
        byte[] postAuthor = visibleAuthor(me, postId);
        if (!limiter.tryAcquire("replies", me, 120, 60_000)) {
            throw ApiException.rateLimited();
        }
        String text = PostController.cleanText(r.text(), MAX_REPLY_CHARS, false);
        UUID replyId = Ids.newId();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO post_replies (id, post_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
                Ids.bytes(replyId), Ids.bytes(postId), me, text, Timestamp.from(now));
        notifier.changed(postAuthor);
        notifier.reply(postAuthor, me, postId, replyId);
        UUID author = Ids.uuid(me);
        return new ReplyView(replyId, author, people.person(author), text, now, 0, false);
    }

    @GetMapping("/v1/posts/{postId}/replies")
    public List<ReplyView> replies(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId,
            @RequestParam(value = "after", required = false) Instant after,
            @RequestParam(value = "limit", defaultValue = "100") int limit) {
        byte[] me = me(jwt);
        visibleAuthor(me, postId);
        List<ReplyRow> rows = jdbc.query("SELECT " + REPLY_COLUMNS + " FROM post_replies r "
                + "WHERE r.post_id = ? AND r.created_at > ? AND r.author_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?) "
                + "ORDER BY r.created_at, r.id LIMIT ?",
                (rs, i) -> replyRow(rs), Ids.bytes(postId), Timestamp.from(after == null ? Instant.EPOCH : after), me, Math.max(1, Math.min(limit, 200)));
        return replyViews(me, rows);
    }

    /** One of a person's replies, with the post it answers (as I see that post). */
    public record UserReply(ReplyView reply, PostController.PostView post) {}

    /** A person's replies on posts I may see, newest first (their profile's Replies tab). */
    @GetMapping("/v1/users/{userId}/replies")
    public List<UserReply> userReplies(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId,
            @RequestParam(value = "before", required = false) Instant before,
            @RequestParam(value = "limit", defaultValue = "30") int limit) {
        byte[] me = me(jwt);
        String notBlocked = " NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)";
        Object[] args = new Object[9];
        args[0] = Ids.bytes(userId);
        System.arraycopy(PostAccess.visibleArgs(me), 0, args, 1, 4);
        args[5] = Timestamp.from(before == null ? Instant.now().plusSeconds(60) : before);
        args[6] = me;
        args[7] = me;
        args[8] = Math.max(1, Math.min(limit, 100));
        List<ReplyRow> rows = jdbc.query("SELECT " + REPLY_COLUMNS + " FROM post_replies r JOIN posts p ON p.id = r.post_id "
                + "WHERE r.author_id = ? AND " + PostAccess.VISIBLE + " AND r.created_at < ? AND r.author_id" + notBlocked
                + " AND p.author_id" + notBlocked + " ORDER BY r.created_at DESC LIMIT ?", (rs, i) -> replyRow(rs), args);
        if (rows.isEmpty()) {
            return List.of();
        }
        List<UUID> postIds = rows.stream().map(ReplyRow::post).distinct().toList();
        Map<UUID, PostController.PostView> byId = new HashMap<>();
        for (PostController.PostView v : posts.views(me, "WHERE p.id IN (" + String.join(",", Collections.nCopies(postIds.size(), "?")) + ")",
                postIds.stream().map(Ids::bytes).toArray())) {
            byId.put(v.postId(), v);
        }
        Map<UUID, UUID> postOf = new HashMap<>();
        rows.forEach(r -> postOf.put(r.id(), r.post()));
        return replyViews(me, rows).stream().filter(v -> byId.containsKey(postOf.get(v.replyId())))
                .map(v -> new UserReply(v, byId.get(postOf.get(v.replyId())))).toList();
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
        notifier.changed(author);
        return Map.of("status", "deleted");
    }

    // ---------- likes on replies ----------

    /** The reply's author, if the reply is on this post and I may see the post; otherwise 404. */
    private byte[] visibleReplyAuthor(byte[] me, UUID postId, UUID replyId) {
        visibleAuthor(me, postId);
        return jdbc.query("SELECT author_id FROM post_replies WHERE id = ? AND post_id = ?", (rs, i) -> rs.getBytes(1),
                Ids.bytes(replyId), Ids.bytes(postId)).stream().findFirst().orElseThrow(ApiException::notFound);
    }

    @PutMapping("/v1/posts/{postId}/replies/{replyId}/like")
    public Map<String, String> likeReply(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId,
            @PathVariable("replyId") UUID replyId) {
        byte[] me = me(jwt);
        byte[] author = visibleReplyAuthor(me, postId, replyId);
        jdbc.update("INSERT IGNORE INTO reply_likes (reply_id, liker_id, created_at) VALUES (?, ?, ?)", Ids.bytes(replyId), me,
                Timestamp.from(Instant.now()));
        notifier.changed(author);
        return Map.of("status", "liked");
    }

    @DeleteMapping("/v1/posts/{postId}/replies/{replyId}/like")
    public Map<String, String> unlikeReply(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId,
            @PathVariable("replyId") UUID replyId) {
        byte[] me = me(jwt);
        byte[] author = visibleReplyAuthor(me, postId, replyId);
        jdbc.update("DELETE FROM reply_likes WHERE reply_id = ? AND liker_id = ?", Ids.bytes(replyId), me);
        notifier.changed(author);
        return Map.of("status", "unliked");
    }

    // ---------- likes ----------

    @PutMapping("/v1/posts/{postId}/like")
    public Map<String, String> like(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId) {
        byte[] me = me(jwt);
        byte[] author = visibleAuthor(me, postId);
        jdbc.update("INSERT IGNORE INTO post_likes (post_id, liker_id, created_at) VALUES (?, ?, ?)", Ids.bytes(postId), me,
                Timestamp.from(Instant.now()));
        notifier.changed(author);
        return Map.of("status", "liked");
    }

    @DeleteMapping("/v1/posts/{postId}/like")
    public Map<String, String> unlike(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId) {
        byte[] me = me(jwt);
        byte[] author = visibleAuthor(me, postId);
        jdbc.update("DELETE FROM post_likes WHERE post_id = ? AND liker_id = ?", Ids.bytes(postId), me);
        notifier.changed(author);
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
