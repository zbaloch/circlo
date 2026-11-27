package com.circlo.server.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** JSON Feed (jsonfeed.org) reads into the same items as RSS and Atom. */
class JsonFeedTest {

    private static final URI BASE = URI.create("https://micro.example/feed.json");
    private static final Instant NOW = Instant.parse("2026-11-27T12:00:00Z");

    private static FeedParser.Feed parse(String json) throws Exception {
        return FeedParser.parse(json.getBytes(StandardCharsets.UTF_8), BASE, NOW);
    }

    @Test
    void readsVersion11WithHtmlContent() throws Exception {
        FeedParser.Feed f = parse("""
                {"version": "https://jsonfeed.org/version/1.1", "title": "Micro <Blog>", "home_page_url": "https://micro.example/",
                 "icon": "/icon-512.png", "favicon": "/favicon.png",
                 "items": [
                  {"id": "2", "url": "https://micro.example/2?utm_source=json", "title": "Second & last",
                   "content_html": "<p>Hello <b>world</b>.</p><script>steal()</script>", "date_published": "2026-11-25T10:00:00+02:00",
                   "authors": [{"name": "Ana"}], "image": "/img/2.jpg"},
                  {"id": 1, "url": "/1", "content_text": "A note without a title.\\n\\nSecond paragraph <not html>.",
                   "date_modified": "2026-11-24T10:00:00Z"}
                 ]}""");
        assertThat(f.title()).isEqualTo("Micro <Blog>");
        assertThat(f.siteUrl()).isEqualTo("https://micro.example/");
        assertThat(f.image()).isEqualTo("https://micro.example/icon-512.png");
        assertThat(f.items()).hasSize(2);
        FeedParser.Item second = f.items().get(0);
        assertThat(second.guid()).isEqualTo("2");
        assertThat(second.title()).isEqualTo("Second & last");
        assertThat(second.url()).isEqualTo("https://micro.example/2");
        assertThat(second.summary()).isEqualTo("Hello world.");
        assertThat(second.author()).isEqualTo("Ana");
        assertThat(second.published()).isEqualTo(Instant.parse("2026-11-25T08:00:00Z"));
        assertThat(second.image()).isEqualTo("https://micro.example/img/2.jpg");
        assertThat(second.content()).extracting(b -> b.get("type")).containsExactly("p");

        // A micro post: no title, plain text; the title is its first words, and its text stays text.
        FeedParser.Item first = f.items().get(1);
        assertThat(first.guid()).isEqualTo("1");
        assertThat(first.url()).isEqualTo("https://micro.example/1");
        assertThat(first.title()).startsWith("A note without a title.");
        assertThat(first.published()).isEqualTo(Instant.parse("2026-11-24T10:00:00Z"));
        assertThat(first.content()).hasSize(2);
        assertThat(first.content().get(1).get("runs")).isEqualTo(List.of(Map.of("text", "Second paragraph <not html>.")));
    }

    @Test
    void readsVersion1AuthorsAndPodcastAttachments() throws Exception {
        FeedParser.Feed f = parse("""
                ﻿  {"version": "https://jsonfeed.org/version/1", "title": "Pod",
                 "items": [{"id": "e1", "url": "https://pod.example/e1", "title": "Episode 1", "summary": "Short <summary>",
                   "content_html": "<p>Notes</p>", "author": {"name": "Bo"},
                   "attachments": [{"url": "https://cdn.example/e1.mp4", "mime_type": "video/mp4"},
                                   {"url": "https://cdn.example/e1.mp3", "mime_type": "audio/mpeg", "duration_in_seconds": 2212.5}]}]}""");
        FeedParser.Item e1 = f.items().get(0);
        assertThat(e1.author()).isEqualTo("Bo");
        assertThat(e1.summary()).isEqualTo("Short <summary>");
        assertThat(e1.audio()).isEqualTo(new FeedParser.Audio("https://cdn.example/e1.mp3", "audio/mpeg", 2212));
        assertThat(e1.hasContent()).isTrue();
    }

    @Test
    void itemsWithoutALinkAreLeftOutAndOtherJsonIsNotAFeed() throws Exception {
        assertThat(parse("""
                {"version": "https://jsonfeed.org/version/1.1", "title": "T", "items": [{"id": "x", "title": "No link"}]}""").items()).isEmpty();
        assertThatThrownBy(() -> parse("{\"name\": \"not a feed\"}")).isInstanceOf(FeedParser.NotAFeed.class);
        assertThatThrownBy(() -> parse("{\"version\": \"https://jsonfeed.org/version/1\"}")).isInstanceOf(FeedParser.NotAFeed.class);
        assertThatThrownBy(() -> parse("{ broken")).isInstanceOf(FeedParser.NotAFeed.class);
    }

    @Test
    void pagesCanNameAJsonFeed() {
        String html = """
                <html><head><link rel="alternate" type="application/feed+json" href="/feed.json">
                <link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>""";
        assertThat(FeedParser.feedLinks(html.getBytes(StandardCharsets.UTF_8), URI.create("https://micro.example/")))
                .containsExactly(URI.create("https://micro.example/feed.json"), URI.create("https://micro.example/feed.xml"));
    }
}
