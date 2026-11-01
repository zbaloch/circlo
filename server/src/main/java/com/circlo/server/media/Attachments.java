package com.circlo.server.media;

import com.circlo.server.storage.MediaStore;
import com.circlo.server.storage.MediaUrlSigner;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Photos and videos on posts and chat messages. Each one is two uploaded files: the photo and its thumbnail, or the
 * video and its poster frame. Files can only be attached by their uploader, once, and only after they've been uploaded
 * with the declared size. Readers get presigned GET URLs; the bucket itself is private.
 */
@Component
public class Attachments {

    public static final int MAX_PER_ITEM = 4;

    public record NewAttachment(@NotNull @Pattern(regexp = "image|video") String type,
            @NotNull @Pattern(regexp = "[0-9a-f]{64}") String objectKey,
            @NotNull @Pattern(regexp = "[0-9a-f]{64}") String previewKey,
            @Min(1) @Max(20_000) int width, @Min(1) @Max(20_000) int height,
            @Min(0) @Max(3_600_000) int durationMs) {}

    public record AttachmentView(String type, String mime, int width, int height, int durationMs, String objectKey, String url,
            String previewKey, String previewUrl) {}

    private final JdbcTemplate jdbc;
    private final MediaStore store;
    private final MediaUrlSigner signer;

    public Attachments(JdbcTemplate jdbc, MediaStore store, MediaUrlSigner signer) {
        this.jdbc = jdbc;
        this.signer = signer;
        this.store = store;
    }

    /**
     * Checks that I uploaded this file recently, it isn't attached to anything yet, and it's in the bucket with the size
     * I declared. Returns its type. Locks the row; call inside the transaction that attaches it.
     */
    public String claim(byte[] me, String objectKey) {
        List<Object[]> rows = jdbc.query("""
                SELECT size_bytes, mime FROM media_uploads
                WHERE object_key = ? AND owner_id = ? AND post_id IS NULL AND message_id IS NULL AND is_avatar = FALSE
                  AND created_at > ? FOR UPDATE""",
                (rs, i) -> new Object[] {rs.getLong(1), rs.getString(2)}, objectKey, me,
                Timestamp.from(Instant.now().minus(MediaSweeper.ATTACH_WINDOW)));
        if (rows.isEmpty()) {
            throw ApiException.badRequest("unknown_media");
        }
        OptionalLong stored = store.size(objectKey);
        if (stored.isEmpty() || stored.getAsLong() != (Long) rows.get(0)[0]) {
            throw ApiException.badRequest("media_not_uploaded");
        }
        return (String) rows.get(0)[1];
    }

    /** Validates and stores the attachments of a new post or message (exactly one of `postId` and `messageId`). */
    public void attach(byte[] me, byte[] postId, byte[] messageId, List<NewAttachment> items) {
        long videos = items.stream().filter(a -> a.type().equals("video")).count();
        if (items.size() > MAX_PER_ITEM || videos > 1 || (videos == 1 && items.size() > 1)) {
            throw ApiException.badRequest("too_much_media");
        }
        Set<String> seen = new HashSet<>();
        int position = 0;
        for (NewAttachment a : items) {
            if (!seen.add(a.objectKey()) || !seen.add(a.previewKey())) {
                throw ApiException.badRequest("duplicate_media");
            }
            String mime = claim(me, a.objectKey());
            String previewMime = claim(me, a.previewKey());
            if (!mime.startsWith(a.type() + "/") || !previewMime.startsWith("image/")) {
                throw ApiException.badRequest("wrong_media_type");
            }
            jdbc.update("""
                    INSERT INTO attachments (id, post_id, message_id, position, type, object_key, preview_key, mime, width, height, duration_ms)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    Ids.bytes(Ids.newId()), postId, messageId, position++, a.type(), a.objectKey(), a.previewKey(), mime, a.width(),
                    a.height(), a.type().equals("video") ? a.durationMs() : 0);
            String column = postId != null ? "post_id" : "message_id";
            Object owner = postId != null ? postId : messageId;
            jdbc.update("UPDATE media_uploads SET " + column + " = ? WHERE object_key IN (?, ?)", owner, a.objectKey(), a.previewKey());
        }
    }

    /** Attachments of many posts (`post_id`) or messages (`message_id`), in order, with fresh download URLs. */
    public Map<UUID, List<AttachmentView>> of(String column, Collection<UUID> ids) {
        if (ids.isEmpty()) {
            return Map.of();
        }
        if (!column.equals("post_id") && !column.equals("message_id")) {
            throw new IllegalArgumentException(column);
        }
        Map<UUID, List<AttachmentView>> out = new HashMap<>();
        jdbc.query("SELECT " + column + ", type, mime, width, height, duration_ms, object_key, preview_key FROM attachments WHERE "
                + column + " IN (" + String.join(",", Collections.nCopies(ids.size(), "?")) + ") ORDER BY " + column + ", position",
                rs -> {
                    out.computeIfAbsent(Ids.uuid(rs.getBytes(1)), k -> new ArrayList<>()).add(new AttachmentView(rs.getString(2),
                            rs.getString(3), rs.getInt(4), rs.getInt(5), rs.getInt(6), rs.getString(7), signer.url(rs.getString(7)),
                            rs.getString(8), signer.url(rs.getString(8))));
                },
                ids.stream().map(Ids::bytes).toArray());
        return out;
    }
}
