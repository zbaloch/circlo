package com.circlo.server.media;

import com.circlo.server.storage.MediaStore;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Removes files nobody uses: uploads never attached within a day (attaching only accepts uploads younger than
 * {@link #ATTACH_WINDOW}, so the sweeper never races a post being created), and files of deleted posts, messages and
 * replaced avatars (marked unattached with an old timestamp when they're let go). The bucket object goes first, then
 * the row, so a failed S3 call is simply retried on the next run.
 */
@Component
public class MediaSweeper {

    static final Duration GRACE = Duration.ofHours(24);
    public static final Duration ATTACH_WINDOW = Duration.ofHours(23);
    private static final int BATCH = 500;

    private final JdbcTemplate jdbc;
    private final MediaStore store;

    public MediaSweeper(JdbcTemplate jdbc, MediaStore store) {
        this.jdbc = jdbc;
        this.store = store;
    }

    /** Hands files that were attached to something now deleted to the next sweep. */
    public static void release(JdbcTemplate jdbc, String where, Object... args) {
        jdbc.update("UPDATE media_uploads SET post_id = NULL, message_id = NULL, is_avatar = FALSE, created_at = ? WHERE " + where,
                prepend(Timestamp.from(Instant.EPOCH), args));
    }

    private static Object[] prepend(Object first, Object[] rest) {
        Object[] out = new Object[rest.length + 1];
        out[0] = first;
        System.arraycopy(rest, 0, out, 1, rest.length);
        return out;
    }

    @Scheduled(fixedDelay = 600_000, initialDelay = 60_000)
    void scheduled() {
        try {
            sweep();
        } catch (RuntimeException e) {
            // Storage unavailable: try again next run. Nothing request-specific to log.
        }
    }

    /** Returns how many objects were removed. */
    public int sweep() {
        List<String> keys = jdbc.queryForList("""
                SELECT object_key FROM media_uploads
                WHERE post_id IS NULL AND message_id IS NULL AND is_avatar = FALSE AND created_at < ? LIMIT""" + " " + BATCH,
                String.class, Timestamp.from(Instant.now().minus(GRACE)));
        for (String key : keys) {
            store.delete(key);
            jdbc.update("DELETE FROM media_uploads WHERE object_key = ? AND post_id IS NULL AND message_id IS NULL AND is_avatar = FALSE", key);
        }
        return keys.size();
    }
}
