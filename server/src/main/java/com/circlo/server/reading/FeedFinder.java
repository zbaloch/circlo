package com.circlo.server.reading;

import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Component;

/**
 * Finds the feed behind what someone typed, so they never need to know what RSS is: the address itself if it's a
 * feed; else the feeds the page names in its head; else a few usual places (/feed, /rss, ...) on the same site.
 */
@Component
public class FeedFinder {

    private static final List<String> USUAL = List.of("/feed", "/rss", "/feed.xml", "/index.xml");
    /** Someone is waiting on the answer: stop trying other places after this. */
    private static final long DEADLINE_NANOS = java.time.Duration.ofSeconds(25).toNanos();

    /** A feed that was found and read. {@code url} is where it's served from (after redirects). */
    public record Found(URI url, FeedParser.Feed feed, FeedHttp.Response response) {}

    /** Nothing Circlo can read there. */
    public static final class NoFeed extends Exception {
        NoFeed() {
            super("no_feed", null, false, false);
        }
    }

    /** The address didn't answer at all (no such host, refused, an untrusted certificate, a timeout). */
    public static final class Unreachable extends Exception {
        Unreachable() {
            super("unreachable", null, false, false);
        }
    }

    private final FeedHttp http;

    public FeedFinder(FeedHttp http) {
        this.http = http;
    }

    public Found find(URI start) throws NoFeed, Unreachable {
        long started = System.nanoTime();
        List<URI> candidates = new ArrayList<>();
        URI origin = start;
        try {
            FeedHttp.Response page = http.get(start, null, null);
            Found direct = read(page);
            if (direct != null) {
                return direct;
            }
            if (!looksLikeHtml(page)) {
                throw new NoFeed();
            }
            candidates.addAll(FeedParser.feedLinks(page.body(), page.url()));
            origin = page.url();
        } catch (FeedHttp.Failed e) {
            if (!e.reached()) {
                throw new Unreachable();
            }
            // Some sites refuse automated visits to their pages (403) but serve their feed to anyone: try the usual places.
        }
        if (candidates.isEmpty()) {
            candidates.addAll(usualPlaces(origin));
        }
        for (URI candidate : candidates) {
            if (System.nanoTime() - started > DEADLINE_NANOS) {
                break;
            }
            try {
                Found found = read(http.get(candidate, null, null));
                if (found != null) {
                    return found;
                }
            } catch (FeedHttp.Failed e) {
                // try the next one
            }
        }
        throw new NoFeed();
    }

    /** /feed, /rss, ... in the page's own folder (a blog under /blog/), then at the site's root. */
    static List<URI> usualPlaces(URI page) {
        java.util.LinkedHashSet<URI> out = new java.util.LinkedHashSet<>();
        for (String path : USUAL) {
            out.add(page.resolve(path.substring(1)));
        }
        for (String path : USUAL) {
            out.add(page.resolve(path));
        }
        return new ArrayList<>(out);
    }

    /** Reads a feed fetched before (refreshes and imports). */
    public Found read(FeedHttp.Response res) {
        if (res.status() != 200) {
            return null;
        }
        try {
            return new Found(res.url(), FeedParser.parse(res.body(), res.url(), Instant.now()), res);
        } catch (FeedParser.NotAFeed e) {
            return null;
        }
    }

    private static boolean looksLikeHtml(FeedHttp.Response res) {
        String type = res.contentType().toLowerCase(Locale.ROOT);
        if (type.contains("html")) {
            return true;
        }
        String start = new String(res.body(), 0, Math.min(res.body().length, 512), java.nio.charset.StandardCharsets.UTF_8)
                .stripLeading().toLowerCase(Locale.ROOT);
        return start.startsWith("<!doctype html") || start.startsWith("<html");
    }
}
