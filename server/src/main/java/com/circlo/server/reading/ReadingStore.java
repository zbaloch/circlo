package com.circlo.server.reading;

import com.circlo.server.web.Ids;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

/**
 * Reading's feeds and articles. One row per feed, shared by everyone who follows it. Everything a feed carries is kept
 * (publishers cap their feeds, and Circlo reads at most 100 items), so a blog that posts twice a year still shows its
 * posts. Articles older than {@link #KEEP} go only beyond each source's newest {@link #KEEP_NEWEST} (ReadingRefresher.sweep).
 */
@Component
public class ReadingStore {

    static final Duration KEEP = Duration.ofDays(60);
    public static final int KEEP_NEWEST = 100;
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final TypeReference<List<java.util.Map<String, Object>>> BLOCKS = new TypeReference<>() {};

    private final JdbcTemplate jdbc;

    public ReadingStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    static byte[] sha256(String s) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The feed at this address, if Circlo has it. */
    public Optional<UUID> sourceAt(URI feedUrl) {
        return jdbc.queryForList("SELECT id FROM reading_sources WHERE feed_url_hash = ?", byte[].class, (Object) sha256(feedUrl.toString()))
                .stream().findFirst().map(Ids::uuid);
    }

    /** The address of a source's logo, if Circlo found one (SourceIcons). */
    public Optional<String> icon(UUID source) {
        return jdbc.queryForList("SELECT icon_url FROM reading_sources WHERE id = ? AND icon_url IS NOT NULL", String.class, (Object) Ids.bytes(source))
                .stream().findFirst();
    }

    /** Adds a feed that was just read, with its articles. Returns its id (an existing one if it was added meanwhile). */
    public UUID add(FeedFinder.Found found, Duration checkEvery) {
        Optional<UUID> existing = sourceAt(found.url());
        if (existing.isPresent()) {
            return existing.get();
        }
        UUID id = Ids.newId();
        Instant now = Instant.now();
        int added = jdbc.update("""
                INSERT IGNORE INTO reading_sources (id, feed_url, feed_url_hash, site_url, title, etag, modified, updated_at, next_check_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", Ids.bytes(id), found.url().toString(), sha256(found.url().toString()),
                found.feed().siteUrl(), found.feed().title(), found.response().etag(), found.response().modified(), Timestamp.from(now),
                Timestamp.from(now.plus(checkEvery)), Timestamp.from(now));
        if (added == 0) {
            return sourceAt(found.url()).orElseThrow();
        }
        storeItems(id, found.feed().items());
        return id;
    }

    /** Adds a feed known only by its address (an import): the next check reads it. */
    public UUID addUnread(URI feedUrl, String title) {
        Optional<UUID> existing = sourceAt(feedUrl);
        if (existing.isPresent()) {
            return existing.get();
        }
        UUID id = Ids.newId();
        Timestamp now = Timestamp.from(Instant.now());
        jdbc.update("""
                INSERT IGNORE INTO reading_sources (id, feed_url, feed_url_hash, title, next_check_at, created_at) VALUES (?, ?, ?, ?, ?, ?)""",
                Ids.bytes(id), feedUrl.toString(), sha256(feedUrl.toString()), title, now, now);
        return sourceAt(feedUrl).orElseThrow();
    }

    /**
     * A feed's articles: new ones are added; ones it has already keep their id, time and read marks, and take the
     * feed's latest title, summary, link and content (publishers fix typos).
     */
    public void storeItems(UUID source, List<FeedParser.Item> items) {
        Instant now = Instant.now();
        for (FeedParser.Item i : items) {
            String content = i.content().isEmpty() ? null : JSON.writeValueAsString(i.content());
            jdbc.update("""
                    INSERT INTO reading_articles (id, source_id, guid_hash, url, title, summary, author, published_at, created_at, content, has_content)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE url = VALUE(url), title = VALUE(title), summary = VALUE(summary), author = VALUE(author),
                      content = VALUE(content), has_content = VALUE(has_content)""", Ids.bytes(Ids.newId()), Ids.bytes(source),
                    sha256(i.guid()), i.url(), i.title(), i.summary(), i.author(), Timestamp.from(i.published()), Timestamp.from(now), content,
                    i.hasContent());
        }
    }

    /** An article's content blocks, as stored (image addresses are the publisher's). */
    static List<java.util.Map<String, Object>> blocks(String json) {
        return json == null ? List.of() : JSON.readValue(json, BLOCKS);
    }

    /** A check that worked: its title and site may have changed. */
    public void checked(UUID source, FeedFinder.Found found, Instant next) {
        jdbc.update("""
                UPDATE reading_sources SET title = ?, site_url = ?, etag = ?, modified = ?, updated_at = ?, failures = 0, failing_since = NULL,
                  next_check_at = ? WHERE id = ?""", found.feed().title(), found.feed().siteUrl(), found.response().etag(),
                found.response().modified(), Timestamp.from(Instant.now()), Timestamp.from(next), Ids.bytes(source));
        storeItems(source, found.feed().items());
    }

    /** A check answered "not modified". */
    public void unchanged(UUID source, Instant next) {
        jdbc.update("UPDATE reading_sources SET updated_at = ?, failures = 0, failing_since = NULL, next_check_at = ? WHERE id = ?",
                Timestamp.from(Instant.now()), Timestamp.from(next), Ids.bytes(source));
    }

    /** A check that failed: tried again later and later (up to 12 hours apart). */
    public void failed(UUID source, Instant now, Duration checkEvery) {
        Integer failures = jdbc.queryForObject("SELECT failures FROM reading_sources WHERE id = ?", Integer.class, (Object) Ids.bytes(source));
        int n = failures == null ? 1 : failures + 1;
        Duration wait = checkEvery.multipliedBy(1L << Math.min(n, 5));
        if (wait.compareTo(Duration.ofHours(12)) > 0) {
            wait = Duration.ofHours(12);
        }
        jdbc.update("UPDATE reading_sources SET failures = ?, failing_since = COALESCE(failing_since, ?), next_check_at = ? WHERE id = ?",
                n, Timestamp.from(Instant.now()), Timestamp.from(now.plus(wait)), Ids.bytes(source));
    }
}
