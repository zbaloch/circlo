package com.circlo.server.media;

import com.circlo.server.auth.TokenService;
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
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Upload slots: random object keys with presigned PUT URLs locked to each declared size and type (valid 15 minutes).
 * Files go straight from the app to the bucket; attaching them to a post, message or avatar happens afterwards.
 */
@RestController
public class UploadController {

    static final long MAX_IMAGE = 25L * 1024 * 1024;
    static final long MAX_VIDEO = 512L * 1024 * 1024;
    static final String MIME = "image/jpeg|image/png|image/webp|video/mp4|video/quicktime|video/webm";

    private final JdbcTemplate jdbc;
    private final MediaUrlSigner signer;
    private final RateLimiter limiter;

    public UploadController(JdbcTemplate jdbc, MediaUrlSigner signer, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.signer = signer;
        this.limiter = limiter;
    }

    public record UploadItem(@Min(1) @Max(MAX_VIDEO) long size, @NotNull @Pattern(regexp = MIME) String mime) {}

    public record UploadRequest(@NotNull @Size(min = 1, max = 2 * Attachments.MAX_PER_ITEM) List<@Valid UploadItem> files) {}

    public record UploadSlot(String objectKey, String putUrl, long size, String mime) {}

    @PostMapping("/v1/media/uploads")
    @Transactional
    public List<UploadSlot> uploads(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody UploadRequest r) {
        byte[] me = Ids.bytes(TokenService.userOf(jwt));
        if (!limiter.tryAcquire("uploads", me, 60, 60_000)) {
            throw ApiException.rateLimited();
        }
        List<UploadSlot> slots = new ArrayList<>();
        for (UploadItem f : r.files()) {
            if (f.mime().startsWith("image/") && f.size() > MAX_IMAGE) {
                throw ApiException.badRequest("file_too_large");
            }
            String key = MediaUrlSigner.newObjectKey();
            jdbc.update("INSERT INTO media_uploads (object_key, owner_id, size_bytes, mime, created_at) VALUES (?, ?, ?, ?, ?)",
                    key, me, f.size(), f.mime(), Timestamp.from(Instant.now()));
            slots.add(new UploadSlot(key, signer.presignPut(key, f.size(), f.mime()).toString(), f.size(), f.mime()));
        }
        return slots;
    }
}
