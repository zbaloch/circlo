package com.circlo.server.reading;

import com.circlo.server.auth.TokenService;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import com.circlo.server.web.RateLimiter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.net.URI;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.parser.Parser;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Reading (2.0): the web feeds I follow and their articles, newest first. Articles are read on their own site; Circlo
 * keeps only titles, plain-text summaries and links. What I follow and what I've read are returned only to me: every
 * query starts from my own follows, so another person's sources and articles are simply not there (404).
 */
@RestController
public class ReadingController {

    static final int MAX_SOURCES = 200;
    /** Finding and following fetch other sites, so they're limited per person. */
    private static final int FINDS_PER_HOUR = 60;

    private final JdbcTemplate jdbc;
    private final FeedFinder finder;
    private final ReadingStore store;
    private final RateLimiter limiter;
    private final ReadingProperties props;
    private final ReadingImages images;
    private final SourceIcons icons;

    public ReadingController(JdbcTemplate jdbc, FeedFinder finder, ReadingStore store, RateLimiter limiter, ReadingProperties props,
            ReadingImages images, SourceIcons icons) {
        this.jdbc = jdbc;
        this.finder = finder;
        this.store = store;
        this.limiter = limiter;
        this.props = props;
        this.images = images;
        this.icons = icons;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(TokenService.userOf(jwt));
    }

    public record SourceUrl(@NotNull @Size(max = 2048) String url) {}

    public record Latest(String title, Instant publishedAt) {}

    /** {@code icon}: a signed Circlo link to the source's logo (ReadingImages), if it has one; else the app draws its initial. */
    public record Found(String feedUrl, String title, String siteUrl, boolean following, List<Latest> articles, String icon) {}

    public record Source(UUID sourceId, String title, String feedUrl, String siteUrl, Instant updatedAt, Instant failingSince, int unread,
            String icon) {}

    /** {@code hasContent}: there's more to read in Circlo (GET /v1/reading/articles/{id}); otherwise it opens on its site. */
    public record Article(UUID articleId, UUID sourceId, String sourceTitle, String title, String summary, String url, String author,
            Instant publishedAt, boolean read, boolean hasContent, String sourceIcon, Audio audio, String image) {}

    /**
     * A podcast episode's audio. {@code url} is the podcast's own file: the phone plays it from there (owner decision
     * 2026-11-27, like tapping through to a site), so creators' download counts stay right.
     */
    public record Audio(String url, String type, Integer durationSeconds) {}

    private Article article(java.sql.ResultSet rs, int iconAt) throws java.sql.SQLException {
        String audioUrl = rs.getString(iconAt + 1);
        Audio audio = audioUrl == null ? null : new Audio(audioUrl, rs.getString(iconAt + 2), (Integer) rs.getObject(iconAt + 3, Integer.class));
        return new Article(Ids.uuid(rs.getBytes(1)), Ids.uuid(rs.getBytes(2)), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6),
                rs.getString(7), rs.getTimestamp(8).toInstant(), rs.getBoolean(9), rs.getBoolean(10), icon(rs.getString(iconAt)), audio,
                icon(rs.getString(iconAt + 4)));
    }

    /** An article with its content as blocks (FeedContent); images are signed Circlo links (ReadingImages). */
    public record ArticleDetail(Article article, List<Map<String, Object>> content) {}

    public record Articles(List<Article> articles, String next) {}

    private static URI input(String url) {
        URI uri = UrlGuard.parseInput(url);
        if (uri == null) {
            throw ApiException.badRequest("invalid_url");
        }
        return uri;
    }

    private void limit(byte[] me) {
        if (!limiter.tryAcquire("reading-find", me, FINDS_PER_HOUR, 3_600_000)) {
            throw ApiException.rateLimited();
        }
    }

    private FeedFinder.Found find(URI uri) {
        try {
            return finder.find(uri);
        } catch (FeedFinder.NoFeed e) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, "no_feed");
        } catch (FeedFinder.Unreachable e) {
            throw new ApiException(HttpStatus.UNPROCESSABLE_CONTENT, "unreachable");
        }
    }

    private boolean follows(byte[] me, UUID source) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM reading_follows WHERE user_id = ? AND source_id = ?", Integer.class, me,
                Ids.bytes(source)) > 0;
    }

    /** What's at an address: the feed's name and latest articles, before following it. Follows nothing. */
    @PostMapping("/v1/reading/sources/find")
    public Found findSource(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody SourceUrl r) {
        byte[] me = me(jwt);
        URI uri = input(r.url());
        limit(me);
        FeedFinder.Found f = find(uri);
        Optional<UUID> known = store.sourceAt(f.url());
        boolean following = known.map(id -> follows(me, id)).orElse(false);
        String logo = known.flatMap(store::icon).orElse(f.feed().image());
        return new Found(f.url().toString(), f.feed().title(), f.feed().siteUrl(), following,
                f.feed().items().stream().limit(3).map(i -> new Latest(i.title(), i.published())).toList(), icon(logo));
    }

    /** Follows the feed at an address (the one find answered with, or a site). Following one I follow already is fine. */
    @PostMapping("/v1/reading/sources")
    @ResponseStatus(HttpStatus.CREATED)
    public Source follow(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody SourceUrl r) {
        byte[] me = me(jwt);
        URI uri = input(r.url());
        UUID source = store.sourceAt(uri).orElse(null);
        if (source == null) {
            limit(me);
            FeedFinder.Found f = find(uri);
            source = store.add(f, props.checkEvery());
            // Its logo, off this request (it can take a few fetches); the list shows it once it's there.
            UUID added = source;
            Thread.ofVirtual().start(() -> {
                try {
                    icons.refreshIfDue(added, f, Instant.now());
                } catch (RuntimeException e) {
                    // The next check looks again.
                }
            });
        }
        if (!follows(me, source)) {
            Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM reading_follows WHERE user_id = ?", Integer.class, (Object) me);
            if (count != null && count >= MAX_SOURCES) {
                throw ApiException.conflict("too_many_sources");
            }
            jdbc.update("INSERT IGNORE INTO reading_follows (user_id, source_id, created_at) VALUES (?, ?, ?)", me, Ids.bytes(source),
                    Timestamp.from(Instant.now()));
        }
        UUID id = source;
        return sources(jwt).stream().filter(s -> s.sourceId().equals(id)).findFirst().orElseThrow();
    }

    @GetMapping("/v1/reading/sources")
    public List<Source> sources(@AuthenticationPrincipal Jwt jwt) {
        byte[] me = me(jwt);
        return jdbc.query("""
                SELECT s.id, s.title, s.feed_url, s.site_url, s.updated_at, s.failing_since,
                  (SELECT COUNT(*) FROM reading_articles a WHERE a.source_id = s.id
                     AND NOT EXISTS (SELECT 1 FROM reading_read r WHERE r.user_id = f.user_id AND r.article_id = a.id)) AS unread,
                  s.icon_url
                FROM reading_follows f JOIN reading_sources s ON s.id = f.source_id
                WHERE f.user_id = ? ORDER BY s.title, s.id""", (rs, i) -> new Source(Ids.uuid(rs.getBytes(1)), rs.getString(2), rs.getString(3),
                rs.getString(4), instant(rs.getTimestamp(5)), instant(rs.getTimestamp(6)), rs.getInt(7), icon(rs.getString(8))), (Object) me);
    }

    /** A signed Circlo link to a source's logo, or null. */
    private String icon(String url) {
        return url == null ? null : images.path(url, Instant.now());
    }

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    @DeleteMapping("/v1/reading/sources/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unfollow(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        if (jdbc.update("DELETE FROM reading_follows WHERE user_id = ? AND source_id = ?", me, Ids.bytes(id)) == 0) {
            throw ApiException.notFound();
        }
        jdbc.update("""
                DELETE r FROM reading_read r JOIN reading_articles a ON a.id = r.article_id WHERE r.user_id = ? AND a.source_id = ?""",
                me, Ids.bytes(id));
    }

    /**
     * Articles from the feeds I follow (or one of them), newest first; `unread` leaves out the ones I've read. Pages
     * with `before`, the `next` of the page before.
     */
    @GetMapping("/v1/reading/articles")
    public Articles articles(@AuthenticationPrincipal Jwt jwt, @RequestParam(name = "source", required = false) UUID source,
            @RequestParam(name = "unread", required = false, defaultValue = "false") boolean unread,
            @RequestParam(name = "before", required = false) String before,
            @RequestParam(name = "limit", required = false, defaultValue = "30") int limit) {
        int n = Math.max(1, Math.min(limit, 100));
        StringBuilder sql = new StringBuilder("""
                SELECT a.id, a.source_id, s.title, a.title, a.summary, a.url, a.author, a.published_at, r.article_id IS NOT NULL, a.has_content,
                  s.icon_url, a.audio_url, a.audio_type, a.duration_seconds, a.image_url
                FROM reading_follows f
                JOIN reading_articles a ON a.source_id = f.source_id
                JOIN reading_sources s ON s.id = a.source_id
                LEFT JOIN reading_read r ON r.user_id = f.user_id AND r.article_id = a.id
                WHERE f.user_id = ?""");
        List<Object> args = new ArrayList<>(List.of((Object) me(jwt)));
        if (source != null) {
            sql.append(" AND f.source_id = ?");
            args.add(Ids.bytes(source));
        }
        if (unread) {
            sql.append(" AND r.article_id IS NULL");
        }
        if (before != null) {
            Cursor c = Cursor.parse(before);
            sql.append(" AND (a.published_at < ? OR (a.published_at = ? AND a.id < ?))");
            args.add(Timestamp.from(c.at()));
            args.add(Timestamp.from(c.at()));
            args.add(Ids.bytes(c.id()));
        }
        sql.append(" ORDER BY a.published_at DESC, a.id DESC LIMIT ").append(n + 1);
        List<Article> rows = jdbc.query(sql.toString(), (rs, i) -> article(rs, 11), args.toArray());
        if (rows.size() <= n) {
            return new Articles(rows, null);
        }
        Article last = rows.get(n - 1);
        return new Articles(rows.subList(0, n), new Cursor(last.publishedAt(), last.articleId()).toString());
    }

    /** Where a page ended: the last article's time (microseconds) and id. */
    record Cursor(Instant at, UUID id) {
        static Cursor parse(String s) {
            try {
                int dot = s.indexOf('.');
                long micros = Long.parseLong(s.substring(0, dot));
                return new Cursor(Instant.ofEpochSecond(Math.floorDiv(micros, 1_000_000L), Math.floorMod(micros, 1_000_000L) * 1000L),
                        UUID.fromString(s.substring(dot + 1)));
            } catch (RuntimeException e) {
                throw ApiException.badRequest("invalid_cursor");
            }
        }

        @Override
        public String toString() {
            return (at.getEpochSecond() * 1_000_000L + at.getNano() / 1000) + "." + id;
        }
    }

    /** One article with its content, for reading in Circlo. Only for people who follow its source (404 otherwise). */
    @GetMapping("/v1/reading/articles/{id}")
    public ArticleDetail article(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        List<ArticleDetail> found = jdbc.query("""
                SELECT a.id, a.source_id, s.title, a.title, a.summary, a.url, a.author, a.published_at, r.article_id IS NOT NULL, a.has_content,
                  a.content, s.icon_url, a.audio_url, a.audio_type, a.duration_seconds, a.image_url
                FROM reading_articles a
                JOIN reading_follows f ON f.source_id = a.source_id AND f.user_id = ?
                JOIN reading_sources s ON s.id = a.source_id
                LEFT JOIN reading_read r ON r.user_id = f.user_id AND r.article_id = a.id
                WHERE a.id = ?""", (rs, i) -> new ArticleDetail(article(rs, 12), withSignedImages(ReadingStore.blocks(rs.getString(11)))), me, Ids.bytes(id));
        if (found.isEmpty()) {
            throw ApiException.notFound();
        }
        return found.get(0);
    }

    /** The publisher's image addresses swapped for signed Circlo links. */
    private List<Map<String, Object>> withSignedImages(List<Map<String, Object>> blocks) {
        Instant now = Instant.now();
        for (Map<String, Object> b : blocks) {
            if ("img".equals(b.get("type")) && b.get("src") instanceof String src) {
                b.put("src", images.path(src, now));
            }
        }
        return blocks;
    }

    private void requireMine(byte[] me, UUID article) {
        Integer n = jdbc.queryForObject("""
                SELECT COUNT(*) FROM reading_articles a JOIN reading_follows f ON f.source_id = a.source_id AND f.user_id = ? WHERE a.id = ?""",
                Integer.class, me, Ids.bytes(article));
        if (n == null || n == 0) {
            throw ApiException.notFound();
        }
    }

    @PutMapping("/v1/reading/articles/{id}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markRead(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        requireMine(me, id);
        jdbc.update("INSERT IGNORE INTO reading_read (user_id, article_id) VALUES (?, ?)", me, Ids.bytes(id));
    }

    @DeleteMapping("/v1/reading/articles/{id}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void markUnread(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        requireMine(me, id);
        jdbc.update("DELETE FROM reading_read WHERE user_id = ? AND article_id = ?", me, Ids.bytes(id));
    }

    public record ReadAll(UUID sourceId) {}

    /** Marks every article read, or every article of one source. */
    @PostMapping("/v1/reading/read-all")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void readAll(@AuthenticationPrincipal Jwt jwt, @RequestBody(required = false) ReadAll r) {
        byte[] me = me(jwt);
        UUID source = r == null ? null : r.sourceId();
        jdbc.update("INSERT IGNORE INTO reading_read (user_id, article_id) SELECT f.user_id, a.id FROM reading_follows f "
                + "JOIN reading_articles a ON a.source_id = f.source_id WHERE f.user_id = ?" + (source == null ? "" : " AND f.source_id = ?"),
                source == null ? new Object[] {me} : new Object[] {me, Ids.bytes(source)});
    }

    /** Whether there's something new since I last opened Reading (the drawer's dot). */
    @GetMapping("/v1/reading/status")
    public Map<String, Boolean> status(@AuthenticationPrincipal Jwt jwt) {
        byte[] me = me(jwt);
        Boolean any = jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM reading_follows f JOIN reading_articles a ON a.source_id = f.source_id
                  JOIN users u ON u.id = f.user_id
                  WHERE f.user_id = ? AND a.created_at > COALESCE(u.reading_seen_until, '1970-01-01')
                    AND NOT EXISTS (SELECT 1 FROM reading_read r WHERE r.user_id = f.user_id AND r.article_id = a.id))""",
                Boolean.class, (Object) me);
        return Map.of("hasNew", Boolean.TRUE.equals(any));
    }

    @PutMapping("/v1/reading/seen")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void seen(@AuthenticationPrincipal Jwt jwt) {
        jdbc.update("UPDATE users SET reading_seen_until = ? WHERE id = ?", Timestamp.from(Instant.now()), me(jwt));
    }

    // ---------- OPML: moving between readers ----------

    public record Opml(@NotNull @Size(max = 1_000_000) String opml) {}

    public record Imported(int added, int skipped) {}

    /**
     * Follows the feeds in an OPML file from another reader. They're added by address and read by the next check, so
     * a long list doesn't wait on every site; one that doesn't work shows as failing in my sources.
     */
    @PostMapping("/v1/reading/import")
    public Imported importOpml(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Opml r) {
        byte[] me = me(jwt);
        // jsoup's XML parser never loads doctypes or external entities.
        Document doc = Jsoup.parse(r.opml(), "", Parser.xmlParser());
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM reading_follows WHERE user_id = ?", Integer.class, (Object) me);
        int room = MAX_SOURCES - (count == null ? 0 : count);
        int added = 0;
        int skipped = 0;
        for (Element outline : doc.getElementsByTag("outline")) {
            String xmlUrl = outline.attributes().getIgnoreCase("xmlUrl");
            if (xmlUrl.isBlank()) {
                continue;
            }
            URI uri = UrlGuard.parseInput(xmlUrl);
            if (uri == null || added >= room) {
                skipped++;
                continue;
            }
            String title = FeedParser.cut(FeedParser.text(outline.attributes().getIgnoreCase("text")), 200);
            UUID source = store.addUnread(uri, title.isEmpty() ? uri.getHost() : title);
            if (!follows(me, source)) {
                jdbc.update("INSERT IGNORE INTO reading_follows (user_id, source_id, created_at) VALUES (?, ?, ?)", me, Ids.bytes(source),
                        Timestamp.from(Instant.now()));
                added++;
            }
        }
        return new Imported(added, skipped);
    }

    /** What I follow, as an OPML file another reader can import. */
    @GetMapping("/v1/reading/export")
    public ResponseEntity<String> exportOpml(@AuthenticationPrincipal Jwt jwt) {
        StringBuilder out = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<opml version=\"2.0\">\n"
                + "  <head><title>Feeds on Circlo</title></head>\n  <body>\n");
        for (Source s : sources(jwt)) {
            out.append("    <outline type=\"rss\" text=\"").append(xml(s.title())).append("\" title=\"").append(xml(s.title()))
                    .append("\" xmlUrl=\"").append(xml(s.feedUrl())).append('"');
            if (s.siteUrl() != null) {
                out.append(" htmlUrl=\"").append(xml(s.siteUrl())).append('"');
            }
            out.append("/>\n");
        }
        out.append("  </body>\n</opml>\n");
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("text/x-opml;charset=UTF-8"))
                .header("Content-Disposition", "attachment; filename=\"circlo-feeds.opml\"")
                .body(out.toString());
    }

    private static String xml(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }
}
