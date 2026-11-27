package com.circlo.server.reading;

import com.circlo.server.web.Ids;
import java.net.URI;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import jakarta.annotation.PreDestroy;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Checks the feeds people follow, each about every {@code circlo.reading.check-every} (30 minutes), once for all its
 * followers, with conditional requests. A feed is claimed before it's fetched, so two server instances don't both
 * fetch it. The work runs on its own thread, a few feeds at a time, so slow sites never hold up Circlo's other
 * scheduled jobs (the daily reminder, the media sweep). Nothing about a feed or its address is logged.
 */
@Component
public class ReadingRefresher {

    private static final int BATCH = 50;
    private static final int AT_ONCE = 8;

    private final ExecutorService worker = Executors.newSingleThreadExecutor(Thread.ofVirtual().name("reading-refresh").factory());
    private final AtomicBoolean running = new AtomicBoolean();

    private final JdbcTemplate jdbc;
    private final FeedHttp http;
    private final FeedFinder finder;
    private final ReadingStore store;
    private final ReadingProperties props;

    public ReadingRefresher(JdbcTemplate jdbc, FeedHttp http, FeedFinder finder, ReadingStore store, ReadingProperties props) {
        this.jdbc = jdbc;
        this.http = http;
        this.finder = finder;
        this.store = store;
        this.props = props;
    }

    @Scheduled(fixedDelay = 60_000, initialDelay = 90_000)
    void scheduled() {
        if (!props.scheduled() || !running.compareAndSet(false, true)) {
            return;
        }
        worker.execute(() -> {
            try {
                refreshDue(Instant.now());
            } catch (RuntimeException e) {
                // Database unavailable: next run.
            } finally {
                running.set(false);
            }
        });
    }

    @PreDestroy
    void stop() {
        worker.shutdownNow();
    }

    @Scheduled(fixedDelay = 3_600_000, initialDelay = 300_000)
    void scheduledSweep() {
        if (!props.scheduled()) {
            return;
        }
        try {
            sweep(Instant.now());
        } catch (RuntimeException e) {
            // next run
        }
    }

    /** Checks every followed feed due by {@code now}. Returns how many were checked. */
    public int refreshDue(Instant now) {
        List<Map<String, Object>> due = jdbc.queryForList("""
                SELECT s.id, s.feed_url, s.etag, s.modified, s.next_check_at FROM reading_sources s
                WHERE s.next_check_at <= ? AND EXISTS (SELECT 1 FROM reading_follows f WHERE f.source_id = s.id)
                ORDER BY s.next_check_at LIMIT""" + " " + BATCH, Timestamp.from(now));
        AtomicInteger checked = new AtomicInteger();
        Semaphore slots = new Semaphore(AT_ONCE);
        try (ExecutorService fetches = Executors.newVirtualThreadPerTaskExecutor()) {
            for (Map<String, Object> row : due) {
                byte[] id = (byte[]) row.get("id");
                // Claim it for a few minutes; another instance that got here first wins.
                int claimed = jdbc.update("UPDATE reading_sources SET next_check_at = ? WHERE id = ? AND next_check_at = ?",
                        Timestamp.from(now.plus(Duration.ofMinutes(10))), id, row.get("next_check_at"));
                if (claimed != 1) {
                    continue;
                }
                slots.acquireUninterruptibly();
                fetches.execute(() -> {
                    try {
                        check(Ids.uuid(id), URI.create((String) row.get("feed_url")), (String) row.get("etag"), (String) row.get("modified"), now);
                        checked.incrementAndGet();
                    } catch (RuntimeException e) {
                        // This feed waits for its claim to run out; the others go on.
                    } finally {
                        slots.release();
                    }
                });
            }
        } // waits for every fetch
        return checked.get();
    }

    private void check(UUID source, URI url, String etag, String modified, Instant now) {
        Instant next = now.plus(props.checkEvery());
        try {
            FeedHttp.Response res = http.get(url, etag, modified);
            if (res.notModified()) {
                store.unchanged(source, next);
                return;
            }
            FeedFinder.Found found = finder.read(res);
            if (found == null) {
                store.failed(source, now, props.checkEvery());
                return;
            }
            store.checked(source, found, next);
        } catch (FeedHttp.Failed e) {
            store.failed(source, now, props.checkEvery());
        }
    }

    /** Lets go of articles older than 60 days and of feeds nobody has followed for a day. */
    public void sweep(Instant now) {
        jdbc.update("DELETE FROM reading_articles WHERE published_at < ?", Timestamp.from(now.minus(ReadingStore.KEEP)));
        jdbc.update("""
                DELETE FROM reading_sources WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM reading_follows f WHERE f.source_id = reading_sources.id)""",
                Timestamp.from(now.minus(Duration.ofDays(1))));
    }
}
