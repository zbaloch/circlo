package com.circlo.server.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** Feeds become titles, plain-text summaries and clean links; nothing from the publisher's HTML survives. */
class FeedParserTest {

    private static final URI BASE = URI.create("https://blog.example/feed.xml");
    private static final Instant NOW = Instant.parse("2026-11-27T12:00:00Z");

    private static FeedParser.Feed parse(String xml) throws Exception {
        return FeedParser.parse(xml.getBytes(StandardCharsets.UTF_8), BASE, NOW);
    }

    @Test
    void readsRss() throws Exception {
        FeedParser.Feed f = parse("""
                <?xml version="1.0"?>
                <rss version="2.0"><channel><title>A &amp; B</title><link>https://blog.example/</link>
                <item><guid>g1</guid><title>Hello <![CDATA[<em>world</em>]]></title><link>https://blog.example/hello</link>
                <author>ana@blog.example (Ana)</author>
                <description><![CDATA[<p>Hi <a href="x">there</a>.</p><img src="https://t.example/p.gif"><script>steal()</script><style>p{}</style>]]></description>
                <pubDate>Wed, 04 Nov 2026 10:00:00 GMT</pubDate></item>
                </channel></rss>""");
        assertThat(f.title()).isEqualTo("A & B");
        assertThat(f.siteUrl()).isEqualTo("https://blog.example/");
        assertThat(f.items()).singleElement().satisfies(i -> {
            assertThat(i.title()).isEqualTo("Hello world");
            assertThat(i.summary()).isEqualTo("Hi there.");
            assertThat(i.url()).isEqualTo("https://blog.example/hello");
            assertThat(i.published()).isEqualTo(Instant.parse("2026-11-04T10:00:00Z"));
            assertThat(i.guid()).isEqualTo("g1");
        });
    }

    @Test
    void readsAtom() throws Exception {
        FeedParser.Feed f = parse("""
                <?xml version="1.0" encoding="utf-8"?>
                <feed xmlns="http://www.w3.org/2005/Atom"><title>Atom blog</title>
                <link rel="alternate" href="https://atom.example/"/><link rel="self" href="https://atom.example/atom.xml"/>
                <entry><id>tag:atom.example,2026:1</id><title type="html">Post &lt;b&gt;one&lt;/b&gt;</title>
                <link rel="alternate" href="/posts/1"/><updated>2026-11-03T08:30:00Z</updated>
                <author><name>Bo</name></author><content type="html">&lt;p&gt;Body&lt;/p&gt;</content></entry>
                </feed>""");
        assertThat(f.title()).isEqualTo("Atom blog");
        assertThat(f.siteUrl()).isEqualTo("https://atom.example/");
        assertThat(f.items()).singleElement().satisfies(i -> {
            assertThat(i.title()).isEqualTo("Post one");
            assertThat(i.summary()).isEqualTo("Body");
            assertThat(i.url()).isEqualTo("https://blog.example/posts/1");
            assertThat(i.author()).isEqualTo("Bo");
            assertThat(i.published()).isEqualTo(Instant.parse("2026-11-03T08:30:00Z"));
        });
    }

    @Test
    void readsTheFeedsOwnLogo() throws Exception {
        assertThat(parse("""
                <?xml version="1.0"?><rss version="2.0"><channel><title>DD</title><link>https://dd.example</link>
                <image><url>/img/logo.png</url><title>DD</title><link>https://dd.example</link></image></channel></rss>""").image())
                .isEqualTo("https://blog.example/img/logo.png");
        assertThat(parse("""
                <?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
                <icon>https://atom.example/icon.png</icon><logo>https://atom.example/wide.png</logo></feed>""").image())
                .isEqualTo("https://atom.example/icon.png");
        assertThat(parse("""
                <?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Pod</title>
                <itunes:image href="https://pod.example/cover.jpg"/></channel></rss>""").image()).isEqualTo("https://pod.example/cover.jpg");
        assertThat(parse("""
                <?xml version="1.0"?><rss version="2.0"><channel><title>Plain</title></channel></rss>""").image()).isNull();
    }

    @Test
    void readsYouTubeChannelFeeds() throws Exception {
        FeedParser.Feed f = parse("""
                <?xml version="1.0" encoding="UTF-8"?>
                <feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
                <title>Veritasium</title><link rel="alternate" href="https://www.youtube.com/channel/UC1"/>
                <entry><id>yt:video:abc</id><yt:videoId>abc</yt:videoId><title>Scientists Said This Wave Was Impossible</title>
                <link rel="alternate" href="https://www.youtube.com/watch?v=abc"/><published>2026-11-25T14:00:52+00:00</published>
                <media:group><media:title>Scientists Said This Wave Was Impossible</media:title>
                <media:thumbnail url="https://i1.ytimg.com/vi/abc/hqdefault.jpg" width="480" height="360"/>
                <media:description>A wave that shouldn't exist.</media:description></media:group></entry>
                </feed>""");
        assertThat(f.items()).singleElement().satisfies(i -> {
            assertThat(i.title()).isEqualTo("Scientists Said This Wave Was Impossible");
            assertThat(i.summary()).isEqualTo("A wave that shouldn't exist.");
            assertThat(i.url()).isEqualTo("https://www.youtube.com/watch?v=abc");
        });
    }

    @Test
    void longSummariesAreCutAtAWord() throws Exception {
        String words = "word ".repeat(200);
        FeedParser.Feed f = parse("<rss version=\"2.0\"><channel><title>T</title><item><title>X</title><link>https://b.example/x</link>"
                + "<description>" + words + "</description></item></channel></rss>");
        String s = f.items().get(0).summary();
        assertThat(s).hasSizeLessThanOrEqualTo(FeedParser.SUMMARY_MAX + 1).endsWith("…").doesNotContain("wor…");
    }

    @Test
    void itemsWithoutASafeLinkAreLeftOutAndDatesAreKeptSane() throws Exception {
        FeedParser.Feed f = parse("""
                <rss version="2.0"><channel><title>T</title>
                <item><title>Script</title><link>javascript:alert(1)</link></item>
                <item><title>Data</title><link>data:text/html,hi</link></item>
                <item><title>Future</title><link>https://b.example/f</link><pubDate>Fri, 01 Jan 2100 00:00:00 GMT</pubDate></item>
                <item><title>Undated</title><link>https://b.example/u</link></item>
                <item><link>https://b.example/untitled</link><description>Only a body</description></item>
                </channel></rss>""");
        assertThat(f.items()).extracting(FeedParser.Item::title).containsExactly("Future", "Undated", "Only a body");
        assertThat(f.items()).allSatisfy(i -> assertThat(i.published()).isEqualTo(NOW));
        // No guid: the link stands in.
        assertThat(f.items().get(0).guid()).isEqualTo("https://b.example/f");
    }

    @Test
    void trackingParametersAreRemovedFromLinks() throws Exception {
        assertThat(FeedParser.cleanLink("https://b.example/a?utm_source=rss&utm_medium=feed&id=7&fbclid=X#top")).isEqualTo("https://b.example/a?id=7#top");
        assertThat(FeedParser.cleanLink("https://b.example/a?utm_campaign=x")).isEqualTo("https://b.example/a");
        assertThat(FeedParser.cleanLink("https://b.example/a?q=a%20b&mc_eid=1&gclid=2")).isEqualTo("https://b.example/a?q=a%20b");
        assertThat(FeedParser.cleanLink("https://b.example/a")).isEqualTo("https://b.example/a");
        assertThat(FeedParser.cleanLink("https://www.bbc.com/urdu/articles/x?at_medium=RSS&at_campaign=rss")).isEqualTo("https://www.bbc.com/urdu/articles/x");
    }

    @Test
    void refusesDoctypesSoEntitiesCantReadFiles() throws Exception {
        assertThatThrownBy(() -> parse("""
                <?xml version="1.0"?><!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]>
                <rss version="2.0"><channel><title>&x;</title></channel></rss>""")).isInstanceOf(FeedParser.NotAFeed.class);
    }

    @Test
    void htmlIsNotAFeed() throws Exception {
        assertThatThrownBy(() -> parse("<html><body>hi</body></html>")).isInstanceOf(FeedParser.NotAFeed.class);
    }

    @Test
    void findsFeedLinksInAPage() throws Exception {
        String html = """
                <html><head>
                <link rel="alternate" type="application/rss+xml" href="/rss.xml">
                <link rel="alternate" type="application/atom+xml" href="https://other.example/atom">
                <link rel="alternate" type="text/html" href="/fr/">
                <link rel="stylesheet" href="/s.css">
                </head></html>""";
        assertThat(FeedParser.feedLinks(html.getBytes(StandardCharsets.UTF_8), URI.create("https://blog.example/post/1")))
                .containsExactly(URI.create("https://blog.example/rss.xml"), URI.create("https://other.example/atom"));
    }
}
