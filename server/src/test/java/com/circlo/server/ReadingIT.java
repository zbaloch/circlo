package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.circlo.server.reading.ReadingRefresher;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Reading (2.0): web feeds people follow. Circlo fetches each feed once for everyone who follows it, keeps titles and
 * plain-text summaries, and links to the article on its own site. Who follows what is returned only to them. Feeds
 * are served here by a local web server (the test profile lets Circlo fetch from localhost; production refuses
 * private addresses, see UrlGuardTest).
 */
class ReadingIT extends IntegrationTest {

    @Autowired
    private ReadingRefresher refresher;

    @Autowired
    private JdbcTemplate jdbc;

    private HttpServer site;
    private String base;
    private final Map<String, String> pages = new ConcurrentHashMap<>();
    private final Map<String, String> types = new ConcurrentHashMap<>();
    private final Map<String, AtomicInteger> hits = new ConcurrentHashMap<>();

    @BeforeAll
    void startSite() throws Exception {
        site = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        site.createContext("/", ex -> {
            String path = ex.getRequestURI().getPath();
            hits.computeIfAbsent(path, k -> new AtomicInteger()).incrementAndGet();
            String body = pages.get(path);
            if (body == null) {
                ex.sendResponseHeaders(404, -1);
                ex.close();
                return;
            }
            String etag = "\"" + Integer.toHexString(body.hashCode()) + "\"";
            if (etag.equals(ex.getRequestHeaders().getFirst("If-None-Match"))) {
                ex.sendResponseHeaders(304, -1);
                ex.close();
                return;
            }
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().set("Content-Type", types.getOrDefault(path, "application/rss+xml; charset=utf-8"));
            ex.getResponseHeaders().set("ETag", etag);
            ex.sendResponseHeaders(200, bytes.length);
            ex.getResponseBody().write(bytes);
            ex.close();
        });
        site.start();
        base = "http://127.0.0.1:" + site.getAddress().getPort();
    }

    @AfterAll
    void stopSite() {
        site.stop(0);
    }

    private void serve(String path, String body, String type) {
        pages.put(path, body);
        types.put(path, type);
    }

    private static String item(String guid, String title, String link, String description, String date) {
        return "<item><guid>" + guid + "</guid><title>" + title + "</title><link>" + link + "</link><description><![CDATA["
                + description + "]]></description><pubDate>" + date + "</pubDate></item>";
    }

    private static String rss(String title, String link, String... items) {
        return "<?xml version=\"1.0\"?><rss version=\"2.0\"><channel><title>" + title + "</title><link>" + link
                + "</link><description>About</description>" + String.join("", items) + "</channel></rss>";
    }

    /** A blog: an HTML page that names its feed, and the feed with three posts. */
    private String blog(String name) {
        serve("/" + name, "<html><head><title>" + name + "</title><link rel=\"alternate\" type=\"application/rss+xml\" href=\"/"
                + name + "/feed.xml\"></head><body>Hi</body></html>", "text/html; charset=utf-8");
        serve("/" + name + "/feed.xml", rss(name + " blog", base + "/" + name,
                item(name + "-1", "First &amp; oldest", base + "/" + name + "/1", "<p>One</p>", "Mon, 02 Nov 2026 10:00:00 GMT"),
                item(name + "-2", "Second", base + "/" + name + "/2?utm_source=rss&amp;id=7",
                        "<p>Two <b>bold</b><img src=\"https://tracker.example/p.gif\" width=\"1\" height=\"1\"></p><script>alert(1)</script>",
                        "Tue, 03 Nov 2026 10:00:00 GMT"),
                item(name + "-3", "Third", "/" + name + "/3", "Three", "Wed, 04 Nov 2026 10:00:00 GMT")),
                "application/rss+xml; charset=utf-8");
        return base + "/" + name + "/feed.xml";
    }

    private String follow(TestUser u, String url) {
        ResponseEntity<Map<String, Object>> r = u.call("POST", "/v1/reading/sources", Map.of("url", url));
        assertThat(r.getStatusCode().value()).isEqualTo(201);
        return (String) r.getBody().get("sourceId");
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> articles(TestUser u, String query) {
        ResponseEntity<Map<String, Object>> r = u.call("GET", "/v1/reading/articles" + query, null);
        assertThat(r.getStatusCode().value()).isEqualTo(200);
        return (List<Map<String, Object>>) r.getBody().get("articles");
    }

    private static List<Object> titles(List<Map<String, Object>> articles) {
        return articles.stream().map(a -> a.get("title")).toList();
    }

    @Test
    @SuppressWarnings("unchecked")
    void findsAFeedFromTheSitesOwnPage() {
        String feed = blog("finder");
        TestUser a = user("read_finder");

        ResponseEntity<Map<String, Object>> found = a.call("POST", "/v1/reading/sources/find", Map.of("url", base + "/finder"));
        assertThat(found.getStatusCode().value()).isEqualTo(200);
        assertThat(found.getBody()).containsEntry("feedUrl", feed).containsEntry("title", "finder blog")
                .containsEntry("siteUrl", base + "/finder").containsEntry("following", false);
        List<Map<String, Object>> latest = (List<Map<String, Object>>) found.getBody().get("articles");
        assertThat(titles(latest)).containsExactly("Third", "Second", "First & oldest");

        // The feed's own address works too; finding follows nothing.
        assertThat(a.call("POST", "/v1/reading/sources/find", Map.of("url", feed)).getBody()).containsEntry("feedUrl", feed);
        assertThat(a.list("GET", "/v1/reading/sources", null).getBody()).isEmpty();
    }

    @Test
    void saysWhenThereIsNoFeedOrTheAddressIsWrong() {
        serve("/plain", "<html><head><title>No feed</title></head><body>Nothing</body></html>", "text/html");
        TestUser a = user("read_nofeed");

        assertThat(a.call("POST", "/v1/reading/sources/find", Map.of("url", base + "/plain")).getBody()).containsEntry("error", "no_feed");
        assertThat(a.call("POST", "/v1/reading/sources/find", Map.of("url", base + "/missing")).getBody()).containsEntry("error", "no_feed");
        for (String bad : List.of("file:///etc/passwd", "ftp://example.com/feed", "javascript:alert(1)", "not a url at all", "")) {
            ResponseEntity<Map<String, Object>> r = a.call("POST", "/v1/reading/sources/find", Map.of("url", bad));
            assertThat(r.getStatusCode().value()).as(bad).isEqualTo(400);
            assertThat(r.getBody()).containsEntry("error", "invalid_url");
        }
    }

    @Test
    void articlesArePlainTextWithCleanLinksNewestFirst() {
        String feed = blog("clean");
        TestUser a = user("read_clean");
        String source = follow(a, feed);

        List<Map<String, Object>> list = articles(a, "");
        assertThat(titles(list)).containsExactly("Third", "Second", "First & oldest");
        Map<String, Object> second = list.get(1);
        assertThat(second).containsEntry("summary", "Two bold").containsEntry("sourceId", source)
                .containsEntry("sourceTitle", "clean blog").containsEntry("read", false);
        // Tracking parameters go; other parameters stay. Relative links are made absolute.
        assertThat(second).containsEntry("url", base + "/clean/2?id=7");
        assertThat(list.get(0)).containsEntry("url", base + "/clean/3");

        assertThat(a.list("GET", "/v1/reading/sources", null).getBody()).singleElement().satisfies(s -> assertThat(s)
                .containsEntry("sourceId", source).containsEntry("title", "clean blog").containsEntry("feedUrl", feed)
                .containsEntry("siteUrl", base + "/clean").containsEntry("unread", 3).containsEntry("failingSince", null));
    }

    @Test
    void readAndUnreadFiltersAndMarkingAllRead() {
        String one = follow(user("read_marks_seed"), blog("marks1"));
        TestUser a = user("read_marks");
        assertThat(follow(a, blog("marks1"))).isEqualTo(one);
        String two = follow(a, blog("marks2"));
        assertThat(articles(a, "")).hasSize(6);

        String first = (String) articles(a, "?source=" + one).get(0).get("articleId");
        assertThat(a.call("PUT", "/v1/reading/articles/" + first + "/read", null).getStatusCode().value()).isEqualTo(204);
        assertThat(articles(a, "?source=" + one).get(0)).containsEntry("read", true);
        assertThat(articles(a, "?unread=true")).hasSize(5).noneMatch(x -> x.get("articleId").equals(first));
        assertThat(a.call("DELETE", "/v1/reading/articles/" + first + "/read", null).getStatusCode().value()).isEqualTo(204);
        assertThat(articles(a, "?unread=true")).hasSize(6);

        // All read in one source, then everywhere.
        assertThat(a.call("POST", "/v1/reading/read-all", Map.of("sourceId", two)).getStatusCode().value()).isEqualTo(204);
        assertThat(articles(a, "?unread=true")).hasSize(3).allMatch(x -> x.get("sourceId").equals(one));
        assertThat(a.call("POST", "/v1/reading/read-all", Map.of()).getStatusCode().value()).isEqualTo(204);
        assertThat(articles(a, "?unread=true")).isEmpty();
    }

    @Test
    @SuppressWarnings("unchecked")
    void pagesThroughOlderArticles() {
        StringBuilder items = new StringBuilder();
        for (int i = 1; i <= 25; i++) {
            items.append(item("p" + i, "Post " + i, base + "/paged/" + i, "Body " + i, String.format("%02d", i) + " Nov 2026 10:00:00 GMT"));
        }
        serve("/paged.xml", rss("Paged", base, items.toString()), "application/rss+xml");
        TestUser a = user("read_paged");
        follow(a, base + "/paged.xml");

        Map<String, Object> page1 = a.call("GET", "/v1/reading/articles?limit=10", null).getBody();
        assertThat(titles((List<Map<String, Object>>) page1.get("articles"))).first().isEqualTo("Post 25");
        Map<String, Object> page2 = a.call("GET", "/v1/reading/articles?limit=10&before=" + page1.get("next"), null).getBody();
        assertThat(titles((List<Map<String, Object>>) page2.get("articles"))).first().isEqualTo("Post 15");
        Map<String, Object> page3 = a.call("GET", "/v1/reading/articles?limit=10&before=" + page2.get("next"), null).getBody();
        assertThat(titles((List<Map<String, Object>>) page3.get("articles"))).hasSize(5).last().isEqualTo("Post 1");
        assertThat(page3.get("next")).isNull();
    }

    @Test
    void whatIFollowIsMineAlone() {
        String feed = blog("mine");
        TestUser a = user("read_mine_a");
        TestUser b = user("read_mine_b");
        String source = follow(a, feed);
        String article = (String) articles(a, "").get(0).get("articleId");

        // b follows nothing, sees nothing, and can't touch a's source or its articles.
        assertThat(b.list("GET", "/v1/reading/sources", null).getBody()).isEmpty();
        assertThat(articles(b, "")).isEmpty();
        assertThat(articles(b, "?source=" + source)).isEmpty();
        assertThat(b.call("PUT", "/v1/reading/articles/" + article + "/read", null).getStatusCode().value()).isEqualTo(404);
        assertThat(b.call("DELETE", "/v1/reading/sources/" + source, null).getStatusCode().value()).isEqualTo(404);
        assertThat(a.list("GET", "/v1/reading/sources", null).getBody()).hasSize(1);

        // Following the same feed shares one copy: Circlo fetched it once, for both of them.
        int fetches = hits.get("/mine/feed.xml").get();
        assertThat(follow(b, feed)).isEqualTo(source);
        assertThat(hits.get("/mine/feed.xml").get()).isEqualTo(fetches);
        assertThat(articles(b, "")).hasSize(3).allMatch(x -> x.get("read").equals(false));
    }

    @Test
    void unfollowing() {
        String feed = blog("leave");
        TestUser a = user("read_leave");
        String source = follow(a, feed);
        assertThat(a.call("DELETE", "/v1/reading/sources/" + source, null).getStatusCode().value()).isEqualTo(204);
        assertThat(a.list("GET", "/v1/reading/sources", null).getBody()).isEmpty();
        assertThat(articles(a, "")).isEmpty();
    }

    @Test
    void newArticlesArriveOnTheNextCheckAndLightTheDot() {
        String feed = blog("fresh");
        TestUser a = user("read_fresh");
        follow(a, feed);
        assertThat(a.call("PUT", "/v1/reading/seen", null).getStatusCode().value()).isEqualTo(204);
        assertThat(a.call("GET", "/v1/reading/status", null).getBody()).containsEntry("hasNew", false);

        // Unchanged: a conditional request answered 304 adds nothing.
        refresher.refreshDue(Instant.now().plus(Duration.ofHours(1)));
        assertThat(articles(a, "")).hasSize(3);

        serve("/fresh/feed.xml", rss("fresh blog", base + "/fresh",
                item("fresh-4", "Fourth", base + "/fresh/4", "Four", "Thu, 05 Nov 2026 10:00:00 GMT"),
                item("fresh-3", "Third", base + "/fresh/3", "Three", "Wed, 04 Nov 2026 10:00:00 GMT")), "application/rss+xml");
        refresher.refreshDue(Instant.now().plus(Duration.ofHours(2)));
        assertThat(titles(articles(a, ""))).containsExactly("Fourth", "Third", "Second", "First & oldest");
        assertThat(a.call("GET", "/v1/reading/status", null).getBody()).containsEntry("hasNew", true);
        a.call("PUT", "/v1/reading/seen", null);
        assertThat(a.call("GET", "/v1/reading/status", null).getBody()).containsEntry("hasNew", false);
    }

    @Test
    void aFeedThatStopsWorkingSaysSoQuietly() {
        String feed = blog("broken");
        TestUser a = user("read_broken");
        follow(a, feed);
        pages.remove("/broken/feed.xml");
        refresher.refreshDue(Instant.now().plus(Duration.ofHours(1)));
        assertThat(a.list("GET", "/v1/reading/sources", null).getBody()).singleElement()
                .satisfies(s -> assertThat(s.get("failingSince")).isNotNull());
        assertThat(articles(a, "")).hasSize(3);
    }

    @Test
    void oldArticlesAndUnfollowedFeedsAreLetGo() {
        String feed = blog("old");
        TestUser a = user("read_old");
        String source = follow(a, feed);
        jdbc.update("UPDATE reading_articles SET published_at = ? WHERE title = 'First & oldest'",
                Timestamp.from(Instant.now().minus(Duration.ofDays(61))));
        refresher.sweep(Instant.now());
        assertThat(titles(articles(a, ""))).containsExactly("Third", "Second");

        a.call("DELETE", "/v1/reading/sources/" + source, null);
        refresher.sweep(Instant.now().plus(Duration.ofDays(2)));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM reading_sources WHERE feed_url = ?", Integer.class, feed)).isZero();
    }

    @Test
    void importAndExportOpml() {
        String one = blog("opml1");
        String two = blog("opml2");
        TestUser a = user("read_opml");
        String opml = "<?xml version=\"1.0\"?><opml version=\"2.0\"><head><title>Mine</title></head><body>"
                + "<outline text=\"Tech\"><outline type=\"rss\" text=\"One\" xmlUrl=\"" + one + "\"/></outline>"
                + "<outline type=\"rss\" text=\"Two\" xmlUrl=\"" + two + "\"/>"
                + "<outline type=\"rss\" text=\"Bad\" xmlUrl=\"file:///etc/passwd\"/></body></opml>";

        ResponseEntity<Map<String, Object>> r = a.call("POST", "/v1/reading/import", Map.of("opml", opml));
        assertThat(r.getStatusCode().value()).isEqualTo(200);
        assertThat(r.getBody()).containsEntry("added", 2).containsEntry("skipped", 1);
        // Imported feeds are fetched by the next check.
        refresher.refreshDue(Instant.now().plus(Duration.ofMinutes(1)));
        assertThat(a.list("GET", "/v1/reading/sources", null).getBody()).extracting(s -> s.get("title"))
                .containsExactlyInAnyOrder("opml1 blog", "opml2 blog");

        String exported = http().get().uri("/v1/reading/export").header("Authorization", "Bearer " + a.accessToken).retrieve().body(String.class);
        assertThat(exported).startsWith("<?xml").contains("<opml version=\"2.0\">").contains("xmlUrl=\"" + one + "\"").contains("xmlUrl=\"" + two + "\"");
    }

    @Test
    @SuppressWarnings("unchecked")
    void myExportListsWhatIFollowAndDeletingMyAccountForgetsIt() {
        String feed = blog("gone");
        TestUser a = user("read_gone");
        follow(a, feed);
        a.call("PUT", "/v1/reading/articles/" + articles(a, "").get(0).get("articleId") + "/read", null);

        Map<String, Object> export = a.call("GET", "/v1/me/export", null).getBody();
        assertThat((List<Map<String, Object>>) export.get("reading")).singleElement()
                .satisfies(s -> assertThat(s).containsEntry("title", "gone blog").containsEntry("feedUrl", feed));

        assertThat(a.call("DELETE", "/v1/account", Map.of("password", a.password)).getStatusCode().value()).isEqualTo(200);
        byte[] id = com.circlo.server.web.Ids.bytes(a.userId);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM reading_follows WHERE user_id = ?", Integer.class, (Object) id)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM reading_read WHERE user_id = ?", Integer.class, (Object) id)).isZero();
    }

    @Test
    void needsASession() {
        assertThat(call("GET", "/v1/reading/sources", null, null).getStatusCode().value()).isEqualTo(401);
        assertThat(call("POST", "/v1/reading/sources/find", Map.of("url", base), null).getStatusCode().value()).isEqualTo(401);
    }
}
