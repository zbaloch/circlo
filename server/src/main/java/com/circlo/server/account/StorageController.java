package com.circlo.server.account;

import com.circlo.server.auth.TokenService;
import com.circlo.server.web.Ids;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * How much storage my account uses (owner request 2026-11-08): every file I keep on Circlo, which is the photos and
 * videos on my posts and chat messages (with their thumbnails and poster frames) and my profile photo. Uploads not
 * attached to anything and files of deleted posts and messages are on their way out (MediaSweeper) and don't count.
 * Only ever my own account.
 */
@RestController
public class StorageController {

    private final JdbcTemplate jdbc;

    public StorageController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Bytes in total and by kind (thumbnails and poster frames are photos), and how many photos and videos. */
    public record Storage(long usedBytes, long photoBytes, long videoBytes, long profilePhotoBytes, long photos, long videos) {}

    @GetMapping("/v1/me/storage")
    public Storage storage(@AuthenticationPrincipal Jwt jwt) {
        byte[] me = Ids.bytes(TokenService.userOf(jwt));
        long[] bytes = jdbc.queryForObject("""
                SELECT COALESCE(SUM(size_bytes), 0),
                       COALESCE(SUM(CASE WHEN mime LIKE 'video/%' THEN size_bytes END), 0),
                       COALESCE(SUM(CASE WHEN is_avatar THEN size_bytes END), 0)
                FROM media_uploads
                WHERE owner_id = ? AND (post_id IS NOT NULL OR message_id IS NOT NULL OR is_avatar)""",
                (rs, i) -> new long[] {rs.getLong(1), rs.getLong(2), rs.getLong(3)}, (Object) me);
        long[] counts = jdbc.queryForObject("""
                SELECT COALESCE(SUM(a.type = 'image'), 0), COALESCE(SUM(a.type = 'video'), 0)
                FROM media_uploads m JOIN attachments a ON a.object_key = m.object_key
                WHERE m.owner_id = ? AND (m.post_id IS NOT NULL OR m.message_id IS NOT NULL)""",
                (rs, i) -> new long[] {rs.getLong(1), rs.getLong(2)}, (Object) me);
        return new Storage(bytes[0], bytes[0] - bytes[1] - bytes[2], bytes[1], bytes[2], counts[0], counts[1]);
    }
}
