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

    public PostController(JdbcTemplate jdbc, MediaUrlSigner signer, MediaStore store, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.signer = signer;
        this.store = store;
        this.limiter = limiter;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(UUID.fromString(jwt.getSubject()));
    }

    private static Timestamp now() {
        return Timestamp.from(Instant.now());
    }

    /** I may read an author's posts if I am the author or an accepted friend. */
    private boolean canRead(byte[] me, byte[] author) {
        return java.util.Arrays.equals(me, author) || !jdbc.queryForList(
                "SELECT 1 FROM friendships WHERE status = 'accepted' AND ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))",
                me, author, author, me).isEmpty();
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
            @NotNull @Size(max = MAX_OBJECTS_PER_POST) List<@Valid MediaRef> media) {}

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
                    "SELECT ct_size FROM media_uploads WHERE object_key = ? AND owner_id = ? AND post_id IS NULL FOR UPDATE",
                    (rs, i) -> rs.getLong(1), m.objectKey(), me);
            if (declared.isEmpty()) {
                throw ApiException.badRequest("unknown_media");
            }
            OptionalLong stored = store.size(m.objectKey());
            if (stored.isEmpty() || stored.getAsLong() != declared.get(0)) {
                throw ApiException.badRequest("media_not_uploaded");
            }
        }
        byte[] postId = Ids.bytes(p.postId());
        jdbc.update("INSERT INTO posts (id, author_id, epoch_id, key_ref, header_ct, created_at, size_bucket) VALUES (?, ?, ?, ?, ?, ?, ?)",
                postId, me, Ids.bytes(p.epochId()), p.keyRef(), p.headerCt(), now(), sizeBucket(p.headerCt().length));
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
        int n = Math.max(1, Math.min(limit, 100));
        Timestamp cursor = Timestamp.from(before == null ? Instant.now().plusSeconds(60) : before);
        List<PostView> posts = jdbc.query(
                "SELECT id, epoch_id, key_ref, header_ct, created_at FROM posts WHERE author_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
                (rs, i) -> new PostView(Ids.uuid(rs.getBytes(1)), userId, Ids.uuid(rs.getBytes(2)), rs.getBytes(3), rs.getBytes(4),
                        rs.getTimestamp(5).toInstant(), new ArrayList<>()),
                author, cursor, n);
        for (PostView p : posts) {
            p.media().addAll(jdbc.query("SELECT object_key, kind, ct_size_padded FROM post_media WHERE post_id = ?",
                    (rs, i) -> new Media(rs.getString(1), rs.getString(2), rs.getLong(3)), (Object) Ids.bytes(p.postId())));
        }
        return posts;
    }

    public record DownloadRequest(@NotNull @Size(min = 1, max = 50) List<@Pattern(regexp = "[0-9a-f]{64}") String> objectKeys) {}

    public record DownloadUrl(String objectKey, String getUrl) {}

    /** 5-minute GET URLs, only for media attached to posts I may read. */
    @PostMapping("/v1/media/download-urls")
    public List<DownloadUrl> downloadUrls(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody DownloadRequest r) {
        byte[] me = me(jwt);
        List<DownloadUrl> out = new ArrayList<>();
        for (String key : r.objectKeys()) {
            List<byte[]> author = jdbc.query(
                    "SELECT p.author_id FROM post_media m JOIN posts p ON p.id = m.post_id WHERE m.object_key = ?",
                    (rs, i) -> rs.getBytes(1), key);
            if (author.isEmpty() || !canRead(me, author.get(0))) {
                throw ApiException.notFound();
            }
            out.add(new DownloadUrl(key, signer.presignGet(key).toString()));
        }
        return out;
    }

    // ---------- delete ----------

    @org.springframework.web.bind.annotation.DeleteMapping("/v1/posts/{postId}")
    @Transactional
    public Map<String, String> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable("postId") UUID postId) {
        int n = jdbc.update("DELETE FROM posts WHERE id = ? AND author_id = ?", Ids.bytes(postId), me(jwt));
        if (n != 1) {
            throw ApiException.notFound();
        }
        return Map.of("status", "deleted");
    }
}
