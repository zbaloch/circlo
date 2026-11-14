package com.circlo.server.desk;

import static com.circlo.server.desk.Desk.me;
import static com.circlo.server.desk.Desk.now;

import com.circlo.server.media.Attachments;
import com.circlo.server.media.MediaSweeper;
import com.circlo.server.storage.MediaUrlSigner;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import com.circlo.server.web.RateLimiter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Desk files (owner decision 2026-11-14): documents, photos and videos in folders, for their owner only. Files go
 * straight from the app to the private bucket with presigned PUTs, like post photos, and are read back with presigned
 * GETs (an hour). They count towards the owner's storage.
 *
 * <p>Only types a browser won't run as a page are accepted (no HTML, SVG or scripts), so a stored file can't become a
 * web page on the storage host. Anything else can still be kept as `application/octet-stream`, which only downloads.
 */
@RestController
public class DeskFilesController {

    static final long MAX_IMAGE = 25L * 1024 * 1024;
    static final long MAX_VIDEO = 512L * 1024 * 1024;
    static final long MAX_OTHER = 100L * 1024 * 1024;
    static final int MAX_FOLDERS = 1000;
    static final int MAX_DEPTH = 20;
    static final String MIME = "image/(jpeg|png|webp|gif|heic|heif)|video/(mp4|quicktime|webm)|audio/(mpeg|mp4|aac|wav|x-m4a|ogg)"
            + "|application/pdf|text/(plain|csv|markdown)|application/rtf|application/zip|application/epub\\+zip|application/octet-stream"
            + "|application/msword|application/vnd\\.ms-excel|application/vnd\\.ms-powerpoint"
            + "|application/vnd\\.openxmlformats-officedocument\\.(wordprocessingml\\.document|spreadsheetml\\.sheet|presentationml\\.presentation)"
            + "|application/vnd\\.oasis\\.opendocument\\.(text|spreadsheet|presentation)";

    private final JdbcTemplate jdbc;
    private final Attachments attachments;
    private final MediaUrlSigner signer;
    private final RateLimiter limiter;

    public DeskFilesController(JdbcTemplate jdbc, Attachments attachments, MediaUrlSigner signer, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.attachments = attachments;
        this.signer = signer;
        this.limiter = limiter;
    }

    public record UploadItem(@Min(1) @Max(MAX_VIDEO) long size, @NotNull @Pattern(regexp = MIME) String mime) {}

    public record UploadRequest(@NotNull @Size(min = 1, max = 2) List<@Valid UploadItem> files) {}

    public record UploadSlot(String objectKey, String putUrl, long size, String mime) {}

    public record FileView(UUID id, UUID folderId, String name, String mime, String kind, long sizeBytes, int width, int height,
            int durationMs, String objectKey, String url, String previewKey, String previewUrl, Instant createdAt) {}

    public record FolderRef(UUID id, String name, UUID parentId) {}

    public record FolderSummary(UUID id, String name, int items, Instant createdAt) {}

    public record Listing(FolderRef folder, List<FolderRef> path, List<FolderSummary> folders, List<FileView> files) {}

    public record NewFile(UUID folderId, @NotNull String name, @NotNull @Pattern(regexp = "[0-9a-f]{64}") String objectKey,
            @Pattern(regexp = "[0-9a-f]{64}") String previewKey, @Min(0) @Max(20_000) Integer width, @Min(0) @Max(20_000) Integer height,
            @Min(0) @Max(36_000_000) Integer durationMs) {}

    public record FileChange(UUID folderId, @NotNull String name) {}

    public record FolderInput(UUID parentId, @NotNull String name) {}

    // ---------------- uploads ----------------

    /** Upload slots for a Desk file and, for a photo or video, its thumbnail or poster frame. */
    @PostMapping("/v1/desk/uploads")
    @Transactional
    public List<UploadSlot> uploads(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody UploadRequest r) {
        byte[] me = me(jwt);
        if (!limiter.tryAcquire("uploads", me, 60, 60_000)) {
            throw ApiException.rateLimited();
        }
        List<UploadSlot> slots = new ArrayList<>();
        for (UploadItem f : r.files()) {
            long max = f.mime().startsWith("image/") ? MAX_IMAGE : f.mime().startsWith("video/") ? MAX_VIDEO : MAX_OTHER;
            if (f.size() > max) {
                throw ApiException.badRequest("file_too_large");
            }
            String key = MediaUrlSigner.newObjectKey();
            jdbc.update("INSERT INTO media_uploads (object_key, owner_id, size_bytes, mime, created_at) VALUES (?, ?, ?, ?, ?)",
                    key, me, f.size(), f.mime(), Timestamp.from(Instant.now()));
            slots.add(new UploadSlot(key, signer.presignPut(key, f.size(), f.mime()).toString(), f.size(), f.mime()));
        }
        return slots;
    }

    // ---------------- reading ----------------

    private static final String FILE_COLUMNS = "id, folder_id, name, mime, size_bytes, width, height, duration_ms, object_key, preview_key, created_at";

    private FileView file(ResultSet rs) throws SQLException {
        String mime = rs.getString(4);
        String preview = rs.getString(10);
        String kind = preview == null ? "file" : mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "file";
        return new FileView(Ids.uuid(rs.getBytes(1)), Desk.uuid(rs.getBytes(2)), rs.getString(3), mime, kind, rs.getLong(5), rs.getInt(6),
                rs.getInt(7), rs.getInt(8), rs.getString(9), signer.url(rs.getString(9)), preview, signer.url(preview),
                rs.getTimestamp(11).toInstant());
    }

    private FolderRef folderRef(byte[] me, UUID id) {
        List<FolderRef> found = jdbc.query("SELECT name, parent_id FROM desk_folders WHERE id = ? AND owner_id = ?",
                (rs, i) -> new FolderRef(id, rs.getString(1), Desk.uuid(rs.getBytes(2))), Ids.bytes(id), me);
        if (found.isEmpty()) {
            throw ApiException.notFound();
        }
        return found.get(0);
    }

    private Listing listing(byte[] me, UUID folderId) {
        FolderRef folder = folderId == null ? null : folderRef(me, folderId);
        List<FolderRef> path = new ArrayList<>();
        for (FolderRef f = folder; f != null && path.size() <= MAX_DEPTH; f = f.parentId() == null ? null : folderRef(me, f.parentId())) {
            path.add(f);
        }
        Collections.reverse(path);
        String where = folderId == null ? "IS NULL" : "= ?";
        Object[] args = folderId == null ? new Object[] {me} : new Object[] {me, Ids.bytes(folderId)};
        List<FolderSummary> folders = jdbc.query("""
                SELECT f.id, f.name, f.created_at,
                       (SELECT COUNT(*) FROM desk_folders c WHERE c.parent_id = f.id) + (SELECT COUNT(*) FROM desk_files x WHERE x.folder_id = f.id)
                FROM desk_folders f WHERE f.owner_id = ? AND f.parent_id\s""" + where + " ORDER BY f.name, f.created_at",
                (rs, i) -> new FolderSummary(Ids.uuid(rs.getBytes(1)), rs.getString(2), rs.getInt(4), rs.getTimestamp(3).toInstant()), args);
        List<FileView> files = jdbc.query("SELECT " + FILE_COLUMNS + " FROM desk_files WHERE owner_id = ? AND folder_id " + where
                + " ORDER BY name, created_at", (rs, i) -> file(rs), args);
        return new Listing(folder, path, folders, files);
    }

    /** The top level: folders and files that aren't in a folder. */
    @GetMapping("/v1/desk/files")
    public Listing root(@AuthenticationPrincipal Jwt jwt) {
        return listing(me(jwt), null);
    }

    @GetMapping("/v1/desk/folders/{id}")
    public Listing folder(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        return listing(me(jwt), id);
    }

    @GetMapping("/v1/desk/files/{id}")
    public FileView getFile(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        return load(me(jwt), id);
    }

    private FileView load(byte[] me, UUID id) {
        List<FileView> found = jdbc.query("SELECT " + FILE_COLUMNS + " FROM desk_files WHERE id = ? AND owner_id = ?", (rs, i) -> file(rs),
                Ids.bytes(id), me);
        if (found.isEmpty()) {
            throw ApiException.notFound();
        }
        return found.get(0);
    }

    // ---------------- folders ----------------

    /** How deep a folder is (1 at the top level); 404 if it isn't mine. */
    private int depth(byte[] me, UUID id) {
        int depth = 0;
        for (UUID f = id; f != null && depth <= MAX_DEPTH; f = folderRef(me, f).parentId()) {
            depth++;
        }
        return depth;
    }

    @PostMapping("/v1/desk/folders")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public FolderRef createFolder(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody FolderInput r) {
        byte[] me = me(jwt);
        String name = Desk.name(r.name(), 100);
        if (r.parentId() != null && depth(me, r.parentId()) >= MAX_DEPTH) {
            throw ApiException.badRequest("too_deep");
        }
        Desk.limitWrites(limiter, me);
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM desk_folders WHERE owner_id = ?", Integer.class, (Object) me);
        if (count != null && count >= MAX_FOLDERS) {
            throw ApiException.conflict("too_many_folders");
        }
        UUID id = Ids.newId();
        jdbc.update("INSERT INTO desk_folders (id, owner_id, parent_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
                Ids.bytes(id), me, Desk.bytes(r.parentId()), name, now());
        return new FolderRef(id, name, r.parentId());
    }

    /** Renames a folder and puts it in `parentId` (the top level when left out). Never inside itself. */
    @PutMapping("/v1/desk/folders/{id}")
    @Transactional
    public FolderRef updateFolder(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody FolderInput r) {
        byte[] me = me(jwt);
        folderRef(me, id);
        String name = Desk.name(r.name(), 100);
        if (r.parentId() != null) {
            for (UUID f = r.parentId(); f != null; f = folderRef(me, f).parentId()) {
                if (f.equals(id)) {
                    throw ApiException.badRequest("folder_inside_itself");
                }
            }
            if (depth(me, r.parentId()) >= MAX_DEPTH) {
                throw ApiException.badRequest("too_deep");
            }
        }
        jdbc.update("UPDATE desk_folders SET name = ?, parent_id = ? WHERE id = ? AND owner_id = ?", name, Desk.bytes(r.parentId()), Ids.bytes(id), me);
        return new FolderRef(id, name, r.parentId());
    }

    /** Deletes a folder with everything in it. Its files' uploads are let go, for the sweeper to remove from the bucket. */
    @DeleteMapping("/v1/desk/folders/{id}")
    @Transactional
    public Map<String, String> deleteFolder(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        folderRef(me, id);
        List<byte[]> all = new ArrayList<>(List.of(Ids.bytes(id)));
        for (int i = 0; i < all.size(); i++) {
            all.addAll(jdbc.query("SELECT id FROM desk_folders WHERE parent_id = ? AND owner_id = ?", (rs, n) -> rs.getBytes(1), all.get(i), me));
        }
        for (byte[] folder : all) {
            MediaSweeper.release(jdbc, "desk_file_id IN (SELECT id FROM desk_files WHERE folder_id = ? AND owner_id = ?)", folder, me);
        }
        jdbc.update("DELETE FROM desk_folders WHERE id = ? AND owner_id = ?", Ids.bytes(id), me);
        return Map.of("status", "deleted");
    }

    // ---------------- files ----------------

    /** Keeps an uploaded file (and its thumbnail or poster frame) in a folder, or at the top level. */
    @PostMapping("/v1/desk/files")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public FileView createFile(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody NewFile r) {
        byte[] me = me(jwt);
        String name = Desk.name(r.name(), 200);
        if (r.folderId() != null) {
            folderRef(me, r.folderId());
        }
        if (r.objectKey().equals(r.previewKey())) {
            throw ApiException.badRequest("duplicate_media");
        }
        String mime = attachments.claim(me, r.objectKey());
        if (r.previewKey() != null) {
            String previewMime = attachments.claim(me, r.previewKey());
            if (!previewMime.startsWith("image/") || !(mime.startsWith("image/") || mime.startsWith("video/"))) {
                throw ApiException.badRequest("wrong_media_type");
            }
        }
        Long size = jdbc.queryForObject("SELECT size_bytes FROM media_uploads WHERE object_key = ?", Long.class, r.objectKey());
        UUID id = Ids.newId();
        jdbc.update("""
                INSERT INTO desk_files (id, owner_id, folder_id, name, object_key, preview_key, mime, size_bytes, width, height, duration_ms, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                Ids.bytes(id), me, Desk.bytes(r.folderId()), name, r.objectKey(), r.previewKey(), mime, size,
                r.width() == null ? 0 : r.width(), r.height() == null ? 0 : r.height(),
                r.durationMs() == null || !mime.startsWith("video/") ? 0 : r.durationMs(), now());
        jdbc.update("UPDATE media_uploads SET desk_file_id = ? WHERE object_key IN (?, ?)", Ids.bytes(id), r.objectKey(),
                r.previewKey() == null ? r.objectKey() : r.previewKey());
        return load(me, id);
    }

    /** Renames a file and puts it in `folderId` (the top level when left out). */
    @PutMapping("/v1/desk/files/{id}")
    @Transactional
    public FileView updateFile(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody FileChange r) {
        byte[] me = me(jwt);
        load(me, id);
        String name = Desk.name(r.name(), 200);
        if (r.folderId() != null) {
            folderRef(me, r.folderId());
        }
        jdbc.update("UPDATE desk_files SET name = ?, folder_id = ? WHERE id = ? AND owner_id = ?", name, Desk.bytes(r.folderId()), Ids.bytes(id), me);
        return load(me, id);
    }

    @DeleteMapping("/v1/desk/files/{id}")
    @Transactional
    public Map<String, String> deleteFile(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        load(me, id);
        MediaSweeper.release(jdbc, "desk_file_id = ? AND owner_id = ?", Ids.bytes(id), me);
        jdbc.update("DELETE FROM desk_files WHERE id = ? AND owner_id = ?", Ids.bytes(id), me);
        return Map.of("status", "deleted");
    }
}
