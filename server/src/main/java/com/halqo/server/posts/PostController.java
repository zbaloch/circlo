package com.halqo.server.posts;

import com.halqo.server.storage.MediaStore;
import com.halqo.server.storage.MediaUrlSigner;
import com.halqo.server.web.ApiException;
import com.halqo.server.web.Ids;
import com.halqo.server.web.RateLimiter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Posts and encrypted media (PLAN.md Phase 7). The server stores an opaque header ciphertext, a per-post key ref that
 * reveals neither the circle nor which posts share an audience, and random object keys for ciphertext blobs.
 */
@RestController
public class PostController {

    static final int CHUNK_SIZE = 65_536;
    static final long MAX_OBJECT = 512L * 1024 * 1024; // padded ciphertext
    static final int MAX_OBJECTS_PER_POST = 12;

    private final JdbcTemplate jdbc;
    private final MediaUrlSigner signer;
    private final MediaStore store;
    private final RateLimiter limiter;
    private final PostAccess access;

    public PostController(JdbcTemplate jdbc, MediaUrlSigner signer, MediaStore store, RateLimiter limiter, PostAccess access) {
        this.jdbc = jdbc;
        this.signer = signer;
        this.store = store;
        this.limiter = limiter;
        this.access = access;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(UUID.fromString(jwt.getSubject()));
    }

    private static Timestamp now() {
        return Timestamp.from(Instant.now());
    }

    private boolean canRead(byte[] me, byte[] author) {
        return access.canRead(me, author);
    }

    // ---------- uploads ----------

    public record UploadRequest(@NotNull @Size(min = 1, max = MAX_OBJECTS_PER_POST) List<@Min(1) @Max(MAX_OBJECT) Long> sizes) {}

    public record UploadSlot(String objectKey, String putUrl, long ctSize) {}

    /** Random object keys with PUT URLs locked to each declared (padded, encrypted) size. Valid for 15 minutes. */
    @PostMapping("/v1/media/uploads")
    @Transactional
    public List<UploadSlot> uploads(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody UploadRequest r) {
        byte[] me = me(jwt);
        if (!limiter.tryAcquire("uploads", me, 60, 60_000)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited");
        }
        List<UploadSlot> slots = new ArrayList<>();
        for (long size : r.sizes()) {
            String key = MediaUrlSigner.newObjectKey();
            jdbc.update("INSERT INTO media_uploads (object_key, owner_id, ct_size, created_at) VALUES (?, ?, ?, ?)", key, me, size, now());
            slots.add(new UploadSlot(key, signer.presignPut(key, size).toString(), size));
        }
        return slots;
    }

    // ---------- create ----------

    public record MediaRef(@NotNull @Pattern(regexp = "[0-9a-f]{64}") String objectKey,
            @NotNull @Pattern(regexp = "full|thumb|poster") String kind) {}

    public record NewPost(@NotNull UUID postId, @NotNull UUID epochId,
            @NotNull @Size(min = 32, max = 32) byte[] keyRef,
            @NotNull @Size(min = 64, max = 65_536) byte[] headerCt,
            @NotNull @Size(max = MAX_OBJECTS_PER_POST) List<@Valid MediaRef> media,
            @NotNull @Size(min = 32, max = 32) byte[] readTokenHash) {}

    @PostMapping("/v1/posts")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Map<String, Object> create(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody NewPost p) {
        byte[] me = me(jwt);
        if (jdbc.queryForList("SELECT 1 FROM epochs WHERE id = ? AND owner_id = ?", Ids.bytes(p.epochId()), me).isEmpty()) {
            throw ApiException.badRequest("unknown_epoch");
        }
        Set<String> seen = new HashSet<>();
        for (MediaRef m : p.media()) {
            if (!seen.add(m.objectKey())) {
                throw ApiException.badRequest("duplicate_media");
            }
            List<Long> declared = jdbc.query(
                    "SELECT ct_size FROM media_uploads WHERE object_key = ? AND owner_id = ? AND post_id IS NULL AND group_id IS NULL AND created_at > ? FOR UPDATE",
                    (rs, i) -> rs.getLong(1), m.objectKey(), me, Timestamp.from(Instant.now().minus(MediaSweeper.ATTACH_WINDOW)));
            if (declared.isEmpty()) {
                throw ApiException.badRequest("unknown_media");
            }
            OptionalLong stored = store.size(m.objectKey());
            if (stored.isEmpty() || stored.getAsLong() != declared.get(0)) {
                throw ApiException.badRequest("media_not_uploaded");
            }
        }
        byte[] postId = Ids.bytes(p.postId());
        jdbc.update("INSERT INTO posts (id, author_id, epoch_id, key_ref, header_ct, created_at, size_bucket, read_token_hash) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                postId, me, Ids.bytes(p.epochId()), p.keyRef(), p.headerCt(), now(), sizeBucket(p.headerCt().length), p.readTokenHash());
        for (MediaRef m : p.media()) {
            long size = jdbc.queryForObject("SELECT ct_size FROM media_uploads WHERE object_key = ?", Long.class, m.objectKey());
            jdbc.update("INSERT INTO post_media (id, post_id, object_key, ct_size_padded, chunk_size, kind) VALUES (?, ?, ?, ?, ?, ?)",
                    Ids.bytes(Ids.newId()), postId, m.objectKey(), size, CHUNK_SIZE, m.kind());
            jdbc.update("UPDATE media_uploads SET post_id = ? WHERE object_key = ?", postId, m.objectKey());
        }
        return Map.of("postId", p.postId());
    }

    static int sizeBucket(int len) {
        return 32 - Integer.numberOfLeadingZeros(Math.max(1, len - 1));
    }

    // ---------- read ----------

    public record Media(String objectKey, String kind, long ctSize) {}

    public record PostView(UUID postId, UUID authorId, UUID epochId, byte[] keyRef, byte[] headerCt, Instant createdAt,
            List<Media> media) {}

    // Counts aren't here: they reveal who interacted, so they come from /v1/posts/stats with the post's read token.
    private static final String VIEW_SELECT = "SELECT p.id, p.author_id, p.epoch_id, p.key_ref, p.header_ct, p.created_at FROM posts p ";

    private List<PostView> views(String where, Object... args) {
        List<PostView> posts = jdbc.query(VIEW_SELECT + where,
                (rs, i) -> new PostView(Ids.uuid(rs.getBytes(1)), Ids.uuid(rs.getBytes(2)), Ids.uuid(rs.getBytes(3)), rs.getBytes(4),
                        rs.getBytes(5), rs.getTimestamp(6).toInstant(), new ArrayList<>()),
                args);
        if (posts.isEmpty()) {
            return posts;
        }
        // All media for the page in one query (not one per post).
        Map<UUID, List<Media>> media = new java.util.HashMap<>();
        jdbc.query("SELECT post_id, object_key, kind, ct_size_padded FROM post_media WHERE post_id IN ("
                + String.join(",", java.util.Collections.nCopies(posts.size(), "?")) + ") ORDER BY post_id, id",
                rs -> {
                    media.computeIfAbsent(Ids.uuid(rs.getBytes(1)), k -> new ArrayList<>())
                            .add(new Media(rs.getString(2), rs.getString(3), rs.getLong(4)));
                }, posts.stream().map(p -> Ids.bytes(p.postId())).toArray());
        posts.forEach(p -> p.media().addAll(media.getOrDefault(p.postId(), List.of())));
        return posts;
    }

    private static Timestamp cursor(Instant before) {
        return Timestamp.from(before == null ? Instant.now().plusSeconds(60) : before);
    }

    /** An author's posts, newest first. Readers try their chain keys locally; the server can't tell who can read what. */
    @GetMapping("/v1/users/{userId}/posts")
    public List<PostView> posts(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId,
            @RequestParam(value = "before", required = false) Instant before,
            @RequestParam(value = "limit", defaultValue = "20") int limit) {
        byte[] me = me(jwt);
        byte[] author = Ids.bytes(userId);
        if (!canRead(me, author)) {
            throw ApiException.notFound();
        }
        return views("WHERE p.author_id = ? AND p.created_at < ? ORDER BY p.created_at DESC LIMIT ?",
                author, cursor(before), Math.max(1, Math.min(limit, 100)));
    }

    /** My posts and my accepted friends' posts in one newest-first page (same headers a per-author fetch returns). */
    @GetMapping("/v1/feed")
    public List<PostView> feed(@AuthenticationPrincipal Jwt jwt,
            @RequestParam(value = "before", required = false) Instant before,
            @RequestParam(value = "limit", defaultValue = "50") int limit) {
        byte[] me = me(jwt);
        return views("""
                WHERE (p.author_id = ? OR p.author_id IN (
                        SELECT user_b FROM friendships WHERE user_a = ? AND status = 'accepted'
                        UNION SELECT user_a FROM friendships WHERE user_b = ? AND status = 'accepted'))
                  AND p.created_at < ? ORDER BY p.created_at DESC LIMIT ?""",
                me, me, me, cursor(before), Math.max(1, Math.min(limit, 200)));
    }

    public record DownloadRequest(@NotNull @Size(min = 1, max = 50) List<@Pattern(regexp = "[0-9a-f]{64}") String> objectKeys) {}

    public record DownloadUrl(String objectKey, String getUrl) {}

    /** 5-minute GET URLs, only for media attached to posts I may read or to chats I'm in. */
    @PostMapping("/v1/media/download-urls")
    public List<DownloadUrl> downloadUrls(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody DownloadRequest r) {
        byte[] me = me(jwt);
        List<DownloadUrl> out = new ArrayList<>();
        for (String key : r.objectKeys()) {
            List<byte[]> author = jdbc.query(
                    "SELECT p.author_id FROM post_media m JOIN posts p ON p.id = m.post_id WHERE m.object_key = ?",
                    (rs, i) -> rs.getBytes(1), key);
            boolean readable = !author.isEmpty() && canRead(me, author.get(0));
            // Chat media: readable by users with an active device in the chat.
            readable = readable || !jdbc.queryForList("""
                    SELECT 1 FROM media_uploads u JOIN mls_group_members gm ON gm.group_id = u.group_id
                    WHERE u.object_key = ? AND gm.user_id = ?""", key, me).isEmpty();
            if (!readable) {
                throw ApiException.notFound();
            }
            out.add(new DownloadUrl(key, signer.presignGet(key).toString()));
        }
        return out;
    }

    // ---------- delete ----------

    /** Deletes my post. Its media objects are handed to {@link MediaSweeper}, which removes them from the bucket. */
    @org.springframework.web.bind.annotation.DeleteMapping("/v1/posts/{postId}")
    @Transactional
    public Map<String, String> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId) {
        byte[] id = Ids.bytes(postId);
        int n = jdbc.update("DELETE FROM posts WHERE id = ? AND author_id = ?", id, me(jwt));
        if (n != 1) {
            throw ApiException.notFound();
        }
        jdbc.update("UPDATE media_uploads SET post_id = NULL, created_at = ? WHERE post_id = ?", Timestamp.from(Instant.EPOCH), id);
        return Map.of("status", "deleted");
    }
}
