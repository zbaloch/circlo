package com.circlo.server.posts;

import com.circlo.server.auth.TokenService;
import com.circlo.server.media.Attachments;
import com.circlo.server.media.MediaSweeper;
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
import java.util.ArrayList;
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
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Posts: text up to 500 characters and up to 4 photos or 1 video, shared with Only me, Everyone (all my friends) or
 * one or more of my circles. The audience is returned only to the author; readers never learn which circle a post
 * went to.
 */
@RestController
public class PostController {

    public static final int MAX_CHARS = 500;

    private final JdbcTemplate jdbc;
    private final PostAccess access;
    private final People people;
    private final Attachments attachments;
    private final RateLimiter limiter;

    public PostController(JdbcTemplate jdbc, PostAccess access, People people, Attachments attachments, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.access = access;
        this.people = people;
        this.attachments = attachments;
        this.limiter = limiter;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(TokenService.userOf(jwt));
    }

    // ---------- create ----------

    /** `kind`: onlyMe, everyone or circles (with `circles`: one or more of my circle ids). */
    public record Audience(@NotNull @Pattern(regexp = "onlyMe|everyone|circles") String kind, @Size(max = 8) List<Integer> circles) {}

    public record NewPost(@NotNull @Size(max = 4 * MAX_CHARS) String text, @NotNull @Valid Audience audience,
            @Size(max = Attachments.MAX_PER_ITEM) List<Attachments.@Valid NewAttachment> media) {}

    static String cleanText(String text, int max, boolean allowEmpty) {
        String t = text == null ? "" : text.strip();
        int n = t.codePointCount(0, t.length());
        if (n > max || (!allowEmpty && n == 0)) {
            throw ApiException.badRequest("invalid_text");
        }
        return t;
    }

    @PostMapping("/v1/posts")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public PostView create(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody NewPost p) {
        byte[] me = me(jwt);
        if (!limiter.tryAcquire("posts", me, 30, 60_000)) {
            throw ApiException.rateLimited();
        }
        List<Attachments.NewAttachment> media = p.media() == null ? List.of() : p.media();
        String text = cleanText(p.text(), MAX_CHARS, !media.isEmpty());
        String audience = switch (p.audience().kind()) {
            case "onlyMe" -> "only_me";
            case "everyone" -> "everyone";
            default -> "circles";
        };
        List<Integer> circles = List.of();
        if (audience.equals("circles")) {
            Set<Integer> mine = new HashSet<>(jdbc.queryForList("SELECT id FROM circles WHERE owner_id = ?", Integer.class, (Object) me));
            circles = p.audience().circles() == null ? List.of() : p.audience().circles().stream().distinct().sorted().toList();
            if (circles.isEmpty() || !mine.containsAll(circles)) {
                throw ApiException.badRequest("invalid_audience");
            }
        }
        UUID postId = Ids.newId();
        byte[] id = Ids.bytes(postId);
        jdbc.update("INSERT INTO posts (id, author_id, body, audience, created_at) VALUES (?, ?, ?, ?, ?)", id, me, text, audience,
                Timestamp.from(Instant.now()));
        for (int c : circles) {
            jdbc.update("INSERT INTO post_circles (post_id, circle_id) VALUES (?, ?)", id, c);
        }
        if (!circles.isEmpty()) {
            // The audience is fixed now: people added to these circles later don't see this post.
            jdbc.update("INSERT IGNORE INTO post_audience (post_id, user_id) SELECT DISTINCT ?, m.member_id FROM circle_members m "
                    + "WHERE m.owner_id = ? AND m.circle_id IN (" + String.join(",", Collections.nCopies(circles.size(), "?")) + ")",
                    concat(new Object[] {id, me}, circles.toArray()));
        }
        attachments.attach(me, id, null, media);
        return views(me, "WHERE p.id = ?", id).get(0);
    }

    private static Object[] concat(Object[] a, Object[] b) {
        Object[] out = new Object[a.length + b.length];
        System.arraycopy(a, 0, out, 0, a.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    // ---------- read ----------

    /** The audience of my own post. Never present on other people's posts. */
    public record AudienceView(String kind, List<Integer> circles) {}

    public record PostView(UUID postId, UUID authorId, People.Person author, String text, Instant createdAt,
            List<Attachments.AttachmentView> media, int replyCount, int likeCount, boolean likedByMe, AudienceView audience) {}

    private static final String SELECT = "SELECT p.id, p.author_id, p.body, p.audience, p.created_at FROM posts p ";

    /** Posts matching `where` (which must already limit them to what `viewer` may see), with everything a card needs. */
    List<PostView> views(byte[] viewer, String where, Object... args) {
        record Row(UUID id, UUID author, String body, String audience, Instant createdAt) {}
        List<Row> rows = jdbc.query(SELECT + where, (rs, i) -> new Row(Ids.uuid(rs.getBytes(1)), Ids.uuid(rs.getBytes(2)), rs.getString(3),
                rs.getString(4), rs.getTimestamp(5).toInstant()), args);
        if (rows.isEmpty()) {
            return List.of();
        }
        List<UUID> ids = rows.stream().map(Row::id).toList();
        String marks = String.join(",", Collections.nCopies(ids.size(), "?"));
        Object[] idArgs = ids.stream().map(Ids::bytes).toArray();
        Map<UUID, People.Person> authors = people.persons(rows.stream().map(Row::author).toList());
        Map<UUID, List<Attachments.AttachmentView>> media = attachments.of("post_id", ids);
        Map<UUID, Integer> replies = counts("SELECT post_id, COUNT(*) FROM post_replies WHERE post_id IN (" + marks + ") GROUP BY post_id", idArgs);
        Map<UUID, Integer> likes = counts("SELECT post_id, COUNT(*) FROM post_likes WHERE post_id IN (" + marks + ") GROUP BY post_id", idArgs);
        Set<UUID> liked = new HashSet<>(jdbc.query("SELECT post_id FROM post_likes WHERE liker_id = ? AND post_id IN (" + marks + ")",
                (rs, i) -> Ids.uuid(rs.getBytes(1)), concat(new Object[] {viewer}, idArgs)));
        Map<UUID, List<Integer>> circles = new HashMap<>();
        jdbc.query("SELECT post_id, circle_id FROM post_circles WHERE post_id IN (" + marks + ") ORDER BY circle_id",
                rs -> {
                    circles.computeIfAbsent(Ids.uuid(rs.getBytes(1)), k -> new ArrayList<>()).add(rs.getInt(2));
                }, idArgs);
        UUID me = Ids.uuid(viewer);
        return rows.stream().filter(r -> authors.containsKey(r.author())).map(r -> {
            AudienceView audience = null;
            if (r.author().equals(me)) {
                audience = switch (r.audience()) {
                    case "only_me" -> new AudienceView("onlyMe", List.of());
                    case "everyone" -> new AudienceView("everyone", List.of());
                    default -> new AudienceView("circles", circles.getOrDefault(r.id(), List.of()));
                };
            }
            return new PostView(r.id(), r.author(), authors.get(r.author()), r.body(), r.createdAt(), media.getOrDefault(r.id(), List.of()),
                    replies.getOrDefault(r.id(), 0), likes.getOrDefault(r.id(), 0), liked.contains(r.id()), audience);
        }).toList();
    }

    private Map<UUID, Integer> counts(String sql, Object[] ids) {
        Map<UUID, Integer> out = new HashMap<>();
        jdbc.query(sql, rs -> {
            out.put(Ids.uuid(rs.getBytes(1)), rs.getInt(2));
        }, ids);
        return out;
    }

    private static Timestamp cursor(Instant before) {
        return Timestamp.from(before == null ? Instant.now().plusSeconds(60) : before);
    }

    private static int clamp(int limit, int max) {
        return Math.max(1, Math.min(limit, max));
    }

    /** My posts and my friends' posts that I may see, newest first. */
    @GetMapping("/v1/feed")
    public List<PostView> feed(@AuthenticationPrincipal Jwt jwt, @RequestParam(value = "before", required = false) Instant before,
            @RequestParam(value = "limit", defaultValue = "30") int limit) {
        byte[] me = me(jwt);
        return views(me, "WHERE " + PostAccess.VISIBLE + " AND p.created_at < ? ORDER BY p.created_at DESC LIMIT ?",
                concat(PostAccess.visibleArgs(me), new Object[] {cursor(before), clamp(limit, 100)}));
    }

    /** One person's posts that I may see (mine, or a friend's), newest first. */
    @GetMapping("/v1/users/{userId}/posts")
    public List<PostView> posts(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId,
            @RequestParam(value = "before", required = false) Instant before,
            @RequestParam(value = "limit", defaultValue = "30") int limit) {
        byte[] me = me(jwt);
        return views(me, "WHERE p.author_id = ? AND " + PostAccess.VISIBLE + " AND p.created_at < ? ORDER BY p.created_at DESC LIMIT ?",
                concat(concat(new Object[] {Ids.bytes(userId)}, PostAccess.visibleArgs(me)), new Object[] {cursor(before), clamp(limit, 100)}));
    }

    /** "See what they can see": my posts exactly as this friend sees them (without my audience badges). */
    @GetMapping("/v1/me/preview/{friendId}")
    public List<PostView> previewAs(@AuthenticationPrincipal Jwt jwt, @PathVariable("friendId") UUID friendId,
            @RequestParam(value = "before", required = false) Instant before,
            @RequestParam(value = "limit", defaultValue = "30") int limit) {
        byte[] me = me(jwt);
        byte[] friend = Ids.bytes(friendId);
        if (!people.friends(me, friend)) {
            throw ApiException.notFound();
        }
        return views(friend, "WHERE p.author_id = ? AND " + PostAccess.VISIBLE + " AND p.created_at < ? ORDER BY p.created_at DESC LIMIT ?",
                concat(concat(new Object[] {me}, PostAccess.visibleArgs(friend)), new Object[] {cursor(before), clamp(limit, 100)}));
    }

    @GetMapping("/v1/posts/{postId}")
    public PostView post(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId) {
        byte[] me = me(jwt);
        List<PostView> v = views(me, "WHERE p.id = ? AND " + PostAccess.VISIBLE, concat(new Object[] {Ids.bytes(postId)}, PostAccess.visibleArgs(me)));
        if (v.isEmpty()) {
            throw ApiException.notFound();
        }
        return v.get(0);
    }

    /** Deletes my post with its replies and likes; its files are removed from the bucket by the sweeper. */
    @DeleteMapping("/v1/posts/{postId}")
    @Transactional
    public Map<String, String> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId) {
        byte[] id = Ids.bytes(postId);
        if (jdbc.update("DELETE FROM posts WHERE id = ? AND author_id = ?", id, me(jwt)) != 1) {
            throw ApiException.notFound();
        }
        MediaSweeper.release(jdbc, "post_id = ?", (Object) id);
        return Map.of("status", "deleted");
    }
}
