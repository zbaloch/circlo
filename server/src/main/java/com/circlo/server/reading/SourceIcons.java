package com.circlo.server.reading;

import com.circlo.server.web.Ids;
import java.net.URI;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * A source's logo, for its tile: the feed's own (Atom icon or logo, RSS image, a podcast's cover), else the one its
 * site names (apple-touch-icon, icon; a YouTube channel's picture), else the site's /favicon.ico. Circlo fetches each
 * to be sure it's really an image, keeps the first that is, and looks again about weekly. Phones get it through the
 * image proxy like any article image (ReadingImages), so sites never see who follows them. Nothing is logged.
 */
@Component
public class SourceIcons {

    static final Duration LOOK_AGAIN = Duration.ofDays(7);
    private static final int MAX_FROM_PAGE = 2;

    private final JdbcTemplate jdbc;
    private final FeedHttp http;

    public SourceIcons(JdbcTemplate jdbc, FeedHttp http) {
        this.jdbc = jdbc;
        this.http = http;
    }

    /** Looks for the source's logo if it never has, or not for a week. Claims the look first, so it happens once. */
    public void refreshIfDue(UUID source, FeedFinder.Found found, Instant now) {
        int claimed = jdbc.update("UPDATE reading_sources SET icon_checked_at = ? WHERE id = ? AND (icon_checked_at IS NULL OR icon_checked_at < ?)",
                Timestamp.from(now), Ids.bytes(source), Timestamp.from(now.minus(LOOK_AGAIN)));
        if (claimed != 1) {
            return;
        }
        String icon = look(found.feed(), found.url());
        if (icon != null) {
            jdbc.update("UPDATE reading_sources SET icon_url = ? WHERE id = ?", icon, Ids.bytes(source));
        }
    }

    /** The first logo that's really an image, or null. */
    String look(FeedParser.Feed feed, URI feedUrl) {
        if (feed.image() != null) {
            String larger = larger(feed.image());
            if (!larger.equals(feed.image()) && isImage(larger)) {
                return larger;
            }
            if (isImage(feed.image())) {
                return feed.image();
            }
        }
        URI site = site(feed, feedUrl);
        if (site == null) {
            return null;
        }
        for (String candidate : fromPage(site)) {
            if (isImage(candidate)) {
                return candidate;
            }
        }
        String favicon = site.resolve("/favicon.ico").toString();
        return isImage(favicon) ? favicon : null;
    }

    private static URI site(FeedParser.Feed feed, URI feedUrl) {
        try {
            return feed.siteUrl() != null ? URI.create(feed.siteUrl()) : feedUrl.resolve("/");
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private List<String> fromPage(URI site) {
        try {
            FeedHttp.Response page = http.get(site, null, null);
            if (page.status() != 200 || page.contentType() == null || !page.contentType().toLowerCase(Locale.ROOT).contains("html")) {
                return List.of();
            }
            return pageIcons(page.body(), page.url());
        } catch (FeedHttp.Failed e) {
            return List.of();
        }
    }

    /**
     * The logos a page names, best first: a YouTube channel's picture; apple-touch-icon (180 px, made for tiles);
     * then the largest icon. Never SVG (it can carry script) or Safari's one-colour mask icon.
     */
    static List<String> pageIcons(byte[] html, URI page) {
        Document doc = Jsoup.parse(new String(html, java.nio.charset.StandardCharsets.UTF_8), page.toString());
        LinkedHashSet<String> out = new LinkedHashSet<>();
        String host = page.getHost() == null ? "" : page.getHost().toLowerCase(Locale.ROOT);
        if (host.equals("youtube.com") || host.endsWith(".youtube.com")) {
            add(out, page, doc.select("meta[property=og:image]").attr("content"));
            add(out, page, doc.select("link[rel=image_src]").attr("href"));
        }
        List<Element> icons = new ArrayList<>();
        for (Element link : doc.select("link[rel]")) {
            List<String> rel = List.of(link.attr("rel").toLowerCase(Locale.ROOT).split("\s+"));
            if (rel.contains("apple-touch-icon") || rel.contains("apple-touch-icon-precomposed")) {
                add(out, page, link.attr("href"));
            } else if (rel.contains("icon")) {
                icons.add(link);
            }
        }
        icons.sort((a, b) -> Integer.compare(size(b), size(a)));
        for (Element link : icons) {
            add(out, page, link.attr("href"));
        }
        return out.stream().limit(MAX_FROM_PAGE).map(SourceIcons::smaller).toList();
    }

    private static void add(LinkedHashSet<String> out, URI page, String href) {
        String url = FeedParser.absoluteUrl(page, href);
        if (url != null && !url.toLowerCase(Locale.ROOT).split("[?#]")[0].endsWith(".svg")) {
            out.add(url);
        }
    }

    /** An icon link's declared size ("32x32"; the largest if several), or 0. */
    private static int size(Element link) {
        if (link.attr("type").toLowerCase(Locale.ROOT).contains("svg")) {
            return -1;
        }
        int best = 0;
        for (String s : link.attr("sizes").toLowerCase(Locale.ROOT).split("\\s+")) {
            String[] wh = s.split("x");
            try {
                best = Math.max(best, Integer.parseInt(wh[0]));
            } catch (NumberFormatException e) {
                // "any" or nothing
            }
        }
        return best;
    }

    /**
     * WordPress feeds name the site icon at 32 px, blurry on a tile; the same icon is kept at 192 px
     * ("cropped-x-32x32.png", or Jetpack's "?fit=32,32"). Tried first, the original if it isn't there.
     */
    static String larger(String url) {
        return url.replaceFirst("-32x32\\.(png|jpe?g|gif|webp)", "-192x192.$1").replaceFirst("([?&])fit=32%2C32", "$1fit=192%2C192");
    }

    /** Google's picture links name their size: a tile needs 176 px, not YouTube's 900. */
    static String smaller(String url) {
        URI u = URI.create(url);
        if (u.getHost() != null && u.getHost().endsWith(".googleusercontent.com")) {
            return url.replaceFirst("=s\\d+(-|$)", "=s176$1");
        }
        return url;
    }

    private boolean isImage(String url) {
        try {
            return ReadingImageController.type(http.image(URI.create(url))) != null;
        } catch (FeedHttp.Failed | IllegalArgumentException e) {
            return false;
        }
    }
}
