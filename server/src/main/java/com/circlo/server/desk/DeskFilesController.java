package com.circlo.server.desk;

import static com.circlo.server.desk.Desk.me;
import static com.circlo.server.desk.Desk.now;

import com.circlo.server.desk.DeskCommentsController.Comment;
import com.circlo.server.desk.DeskCommentsController.On;
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
 * Desk files (owner decision 2026-11-14, boards 2026-11-15): documents, photos and videos on a board, each with a title
 * and an optional description, and comments, for their owner only. Files go straight from the app to the private bucket
 * with presigned PUTs, like post photos, and are read back with presigned GETs (an hour). They count towards the owner's
 * storage.
 *
 * <p>Only types a browser won't run as a page are accepted (no HTML, SVG or scripts), so a stored file can't become a
 * web page on the storage host. Anything else can still be kept as `application/octet-stream`, which only downloads.
 */
@RestController
public class DeskFilesController {

    static final long MAX_IMAGE = 25L * 1024 * 1024;
    static final long MAX_VIDEO = 512L * 1024 * 1024;
    static final long MAX_OTHER = 100L * 1024 * 1024;
    static final int MAX_TITLE = 200;
    static final int MAX_DESCRIPTION = 10_000;
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

    public record FileView(UUID id, UUID boardId, String boardName, String title, String description, String fileName, String mime, String kind,
            long sizeBytes, int width, int height, int durationMs, String objectKey, String url, String previewKey, String previewUrl, int commentCount,
            Instant createdAt) {}

    public record FileDetail(FileView file, List<Comment> comments) {}

    public record NewFile(@NotNull UUID boardId, @NotNull String title, String description, @NotNull String fileName,
            @NotNull @Pattern(regexp = "[0-9a-f]{64}") String objectKey, @Pattern(regexp = "[0-9a-f]{64}") String previewKey,
            @Min(0) @Max(20_000) Integer width, @Min(0) @Max(20_000) Integer height, @Min(0) @Max(36_000_000) Integer durationMs) {}

    public record FileChange(@NotNull UUID boardId, @NotNull String title, String description) {}

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

    private static final String SELECT = "SELECT f.id, f.board_id, b.name, f.title, f.description, f.file_name, f.mime, f.size_bytes, f.width, f.height,"
            + " f.duration_ms, f.object_key, f.preview_key, f.created_at, " + DeskCommentsController.count(On.files, "f")
            + " FROM desk_files f JOIN desk_boards b ON b.id = f.board_id";

    private FileView file(ResultSet rs) throws SQLException {
        String mime = rs.getString(7);
        String preview = rs.getString(13);
        String kind = preview == null ? "file" : mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video" : "file";
        return new FileView(Ids.uuid(rs.getBytes(1)), Ids.uuid(rs.getBytes(2)), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6), mime,
                kind, rs.getLong(8), rs.getInt(9), rs.getInt(10), rs.getInt(11), rs.getString(12), signer.url(rs.getString(12)), preview,
                signer.url(preview), rs.getInt(15), rs.getTimestamp(14).toInstant());
    }

    /** A board's files, newest first. */
    @GetMapping("/v1/desk/boards/{id}/files")
    public List<FileView> boardFiles(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        Desk.board(jdbc, me, id);
        return jdbc.query(SELECT + " WHERE f.owner_id = ? AND f.board_id = ? ORDER BY f.created_at DESC, f.id DESC LIMIT 2000", (rs, i) -> file(rs),
                me, Ids.bytes(id));
    }

    @GetMapping("/v1/desk/files/{id}")
    public FileDetail getFile(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        return new FileDetail(load(me(jwt), id), DeskCommentsController.list(jdbc, On.files, id));
    }

    private FileView load(byte[] me, UUID id) {
        List<FileView> found = jdbc.query(SELECT + " WHERE f.id = ? AND f.owner_id = ?", (rs, i) -> file(rs), Ids.bytes(id), me);
        if (found.isEmpty()) {
            throw ApiException.notFound();
        }
        return found.get(0);
    }

    // ---------------- files ----------------

    /** Keeps an uploaded file (and its thumbnail or poster frame) on a board. */
    @PostMapping("/v1/desk/files")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public FileView createFile(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody NewFile r) {
        byte[] me = me(jwt);
        String title = Desk.line(r.title(), MAX_TITLE, "invalid_title");
        String description = Desk.description(r.description(), MAX_DESCRIPTION);
        String fileName = Desk.line(r.fileName(), MAX_TITLE, "invalid_name");
        Desk.board(jdbc, me, r.boardId());
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
                INSERT INTO desk_files (id, owner_id, board_id, title, description, file_name, object_key, preview_key, mime, size_bytes, width, height,
                  duration_ms, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                Ids.bytes(id), me, Ids.bytes(r.boardId()), title, description, fileName, r.objectKey(), r.previewKey(), mime, size,
                r.width() == null ? 0 : r.width(), r.height() == null ? 0 : r.height(),
                r.durationMs() == null || !mime.startsWith("video/") ? 0 : r.durationMs(), now());
        jdbc.update("UPDATE media_uploads SET desk_file_id = ? WHERE object_key IN (?, ?)", Ids.bytes(id), r.objectKey(),
                r.previewKey() == null ? r.objectKey() : r.previewKey());
        return load(me, id);
    }

    /** Changes a file's title and description and puts it on `boardId`. */
    @PutMapping("/v1/desk/files/{id}")
    @Transactional
    public FileView updateFile(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody FileChange r) {
        byte[] me = me(jwt);
        load(me, id);
        String title = Desk.line(r.title(), MAX_TITLE, "invalid_title");
        String description = Desk.description(r.description(), MAX_DESCRIPTION);
        Desk.board(jdbc, me, r.boardId());
        jdbc.update("UPDATE desk_files SET board_id = ?, title = ?, description = ? WHERE id = ? AND owner_id = ?", Ids.bytes(r.boardId()), title,
                description, Ids.bytes(id), me);
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
