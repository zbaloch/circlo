package com.halqo.server.posts;

import com.halqo.server.storage.MediaStore;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Removes ciphertext nobody can use: uploads never attached to a post within a day (posts may only attach uploads
 * younger than {@link #ATTACH_WINDOW}, so the sweeper never races a post being created) and media of deleted posts
 * (marked unattached with an old timestamp on delete).
 * The bucket object goes first, then the row, so a failed S3 call is simply retried on the next run.
 */
@Component
public class MediaSweeper {

    static final Duration GRACE = Duration.ofHours(24);
    static final Duration ATTACH_WINDOW = Duration.ofHours(23);
    private static final int BATCH = 500;

    private final JdbcTemplate jdbc;
    private final MediaStore store;

    public MediaSweeper(JdbcTemplate jdbc, MediaStore store) {
        this.jdbc = jdbc;
        this.store = store;
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
        List<String> keys = jdbc.queryForList(
                "SELECT object_key FROM media_uploads WHERE post_id IS NULL AND created_at < ? LIMIT " + BATCH, String.class,
                Timestamp.from(Instant.now().minus(GRACE)));
        for (String key : keys) {
            store.delete(key);
            jdbc.update("DELETE FROM media_uploads WHERE object_key = ? AND post_id IS NULL", key);
        }
        return keys.size();
    }
}
