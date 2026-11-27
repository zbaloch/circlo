package com.circlo.server.reading;

import com.rometools.rome.feed.synd.SyndContent;
import com.rometools.rome.feed.synd.SyndEnclosure;
import com.rometools.rome.feed.synd.SyndEntry;
import com.rometools.rome.feed.synd.SyndFeed;
import com.rometools.rome.feed.synd.SyndLink;
import com.rometools.rome.io.SyndFeedInput;
import com.rometools.rome.io.XmlReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.Semaphore;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

/**
 * Turns an RSS or Atom feed (ROME) into what Reading shows: titles, plain-text summaries (jsoup; no HTML, images or
 * scripts from the publisher survive) and links to the article on its own site, minus tracking parameters. Doctypes
 * are refused, so a feed can't use XML entities to read files or call other addresses.
 */
public final class FeedParser {

    static final int SUMMARY_MAX = 300;
    private static final int TITLE_MAX = 300;
    private static final int MAX_ITEMS = 100;
    /** Feeds bigger than this (podcast archives) are parsed one at a time, as the whole document is held in memory. */
    private static final int BIG = 5 * 1024 * 1024;
    private static final Semaphore BIG_AT_ONCE = new Semaphore(1);
    private static final Set<String> TRACKING = Set.of("fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid",
            "igshid", "mc_cid", "mc_eid", "mkt_tok", "_hsenc", "_hsmi", "__hssc", "__hstc", "__hsfp", "hsctatracking", "oly_anon_id",
            "oly_enc_id", "rb_clickid", "s_cid", "vero_conv", "vero_id", "wickedid", "ck_subscriber_id", "ss_source", "ss_campaign_id",
            // AT Internet / Piano (BBC and others)
            "at_medium", "at_campaign", "at_custom1", "at_custom2", "at_custom3", "at_custom4", "at_ptr_name", "at_link_origin",
            "at_link_type", "at_link_id", "at_format", "at_bbc_team");

    /**
     * A feed. {@code siteUrl} is the site it belongs to, if it says; {@code image} its own logo or cover art, if it
     * names one (Atom icon or logo, RSS image, iTunes cover).
     */
    public record Feed(String title, String siteUrl, String image, List<Item> items) {}

    /**
     * One article: {@code guid} identifies it within its feed. {@code content} is its full text as blocks (FeedContent);
     * {@code hasContent} says whether that's worth opening in Circlo, rather than a title and a line. A podcast
     * episode has its {@code audio} (always opened in Circlo, to play it there) and may have its own artwork.
     */
    public record Item(String guid, String url, String title, String summary, String author, Instant published,
            List<java.util.Map<String, Object>> content, boolean hasContent, Audio audio, String image) {

        /** Without content (tests and callers that only need the headline). */
        public Item(String guid, String url, String title, String summary, String author, Instant published) {
            this(guid, url, title, summary, author, published, List.of(), false, null, null);
        }
    }

    /** A podcast episode's audio file (the feed's enclosure), its type and length in seconds, as far as the feed says. */
    public record Audio(String url, String type, Integer seconds) {}

    private static final java.util.regex.Pattern AUDIO_FILE = java.util.regex.Pattern.compile("(?i).*\\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$");

    /** Not a feed Circlo can read (HTML, broken XML, a doctype). */
    public static final class NotAFeed extends Exception {
        NotAFeed() {
            super("not_a_feed", null, false, false);
        }
    }

    private FeedParser() {}

    public static Feed parse(byte[] body, URI base, Instant now) throws NotAFeed {
        if (JsonFeed.looksLikeJson(body)) {
            return JsonFeed.parse(body, base, now);
        }
        SyndFeed feed;
        boolean big = body.length > BIG;
        try {
            if (big) {
                BIG_AT_ONCE.acquire();
            }
            SyndFeedInput input = new SyndFeedInput(false, Locale.ROOT);
            input.setAllowDoctypes(false);
            input.setXmlHealerOn(true);
            feed = input.build(new XmlReader(new ByteArrayInputStream(body), true));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new NotAFeed();
        } catch (Exception e) {
            throw new NotAFeed();
        } finally {
            if (big) {
                BIG_AT_ONCE.release();
            }
        }
        // Atom names the site as the "alternate" link (ROME's getLink() can be the feed's own "self").
        String site = absolute(base, feed.getLinks().stream().filter(l -> "alternate".equals(l.getRel())).map(SyndLink::getHref)
                .findFirst().orElse(feed.getLink()));
        List<Item> items = new ArrayList<>();
        for (SyndEntry e : feed.getEntries()) {
            if (items.size() == MAX_ITEMS) {
                break;
            }
            Item item = item(e, base, now);
            if (item != null) {
                items.add(item);
            }
        }
        items.sort(Comparator.comparing(Item::published).reversed());
        String title = cut(text(feed.getTitle()), 200);
        if (title.isEmpty()) {
            title = site != null ? URI.create(site).getHost() : base.getHost();
        }
        return new Feed(title, site, image(feed, base), items);
    }

    /** The feed's own logo: Atom's icon (small and square), else RSS's image or Atom's logo, else a podcast's cover. */
    private static String image(SyndFeed feed, URI base) {
        List<String> candidates = new ArrayList<>();
        if (feed.getIcon() != null) {
            candidates.add(feed.getIcon().getUrl());
        }
        if (feed.getImage() != null) {
            candidates.add(feed.getImage().getUrl());
        }
        for (org.jdom2.Element el : feed.getForeignMarkup()) {
            if ("image".equals(el.getName()) && el.getAttributeValue("href") != null) {
                candidates.add(el.getAttributeValue("href"));
            }
        }
        return candidates.stream().map(c -> absolute(base, c)).filter(java.util.Objects::nonNull).findFirst().orElse(null);
    }

    private static Item item(SyndEntry e, URI base, Instant now) {
        String link = e.getLink();
        if (link == null || link.isBlank()) {
            link = e.getLinks().stream().filter(l -> l.getRel() == null || "alternate".equals(l.getRel())).map(SyndLink::getHref)
                    .findFirst().orElse(null);
        }
        String description = e.getDescription() != null ? e.getDescription().getValue() : null;
        String full = e.getContents().isEmpty() ? null : ((SyndContent) e.getContents().get(0)).getValue();
        String media = mediaDescription(e);
        // The summary is the description; the content is the fullest text the feed carries (content:encoded, Atom
        // content), else the description, else YouTube's media:description.
        String body = !blank(description) ? description : !blank(full) ? full : media;
        String fullest = !blank(full) ? full : !blank(description) ? description : media;
        Date date = e.getPublishedDate() != null ? e.getPublishedDate() : e.getUpdatedDate();
        return item(e.getUri(), absolute(base, link), e.getTitle(), body, fullest, author(e.getAuthor()), date == null ? null : date.toInstant(),
                audio(e, base), itemImage(e, base), now);
    }

    /**
     * One item, whatever the format (RSS, Atom, JSON Feed): {@code url} is absolute (or null: left out); {@code title},
     * {@code summary} and {@code content} are HTML as the feed has them. Null when it has no link or nothing to call it.
     */
    static Item item(String id, String url, String title, String summary, String content, String author, Instant date, Audio audio,
            String image, Instant now) {
        if (url == null) {
            return null;
        }
        url = cleanLink(url);
        String plain = cut(text(summary), SUMMARY_MAX);
        String name = cut(text(title), TITLE_MAX);
        if (name.isEmpty()) {
            name = cut(plain, 100);
        }
        if (name.isEmpty()) {
            return null;
        }
        String guid = id != null && !id.isBlank() ? id.strip() : url;
        Instant published = date == null || date.isAfter(now) ? now : date;
        FeedContent.Result blocks = FeedContent.convert(content, URI.create(url));
        // Worth opening in Circlo when it says clearly more than the summary, or has pictures, or can be played.
        boolean hasContent = audio != null
                || !blocks.blocks().isEmpty() && (blocks.textLength() > plain.length() + 150 || blocks.images() > 0);
        return new Item(guid, url, name, plain, author, published, blocks.blocks(), hasContent, audio, image);
    }

    /** The first enclosure that's audio (by its type, or by its file name when the feed gives no type). Video is left out. */
    private static Audio audio(SyndEntry e, URI base) {
        for (SyndEnclosure enc : e.getEnclosures()) {
            String url = absolute(base, enc.getUrl());
            if (url == null) {
                continue;
            }
            Audio audio = audio(url, enc.getType(), duration(e));
            if (audio != null) {
                return audio;
            }
        }
        return null;
    }

    /** An attachment as audio, if it is (by its type, or by its file name when there's no type); video is left out. */
    static Audio audio(String url, String rawType, Integer seconds) {
        String type = rawType == null ? "" : rawType.strip().toLowerCase(Locale.ROOT);
        String path = URI.create(url).getPath();
        if (type.startsWith("audio/") || type.isEmpty() && path != null && AUDIO_FILE.matcher(path).matches()) {
            return new Audio(url, type.isEmpty() || type.length() > 100 ? null : type, seconds);
        }
        return null;
    }

    /** itunes:duration: "1:02:03", "42:10", "3723" or "3723.5" seconds; null if missing or odd. */
    static Integer duration(SyndEntry e) {
        for (org.jdom2.Element el : e.getForeignMarkup()) {
            if ("duration".equals(el.getName())) {
                return seconds(el.getTextTrim());
            }
        }
        return null;
    }

    static Integer seconds(String s) {
        if (s == null || s.isEmpty()) {
            return null;
        }
        try {
            long total = 0;
            for (String part : s.split(":", -1)) {
                total = total * 60 + (long) Double.parseDouble(part);
            }
            return total > 0 && total < 7L * 24 * 3600 ? (int) total : null;
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    /**
     * An item's own picture: a podcast episode's artwork (itunes:image), else the largest Media RSS thumbnail (YouTube
     * puts it in media:group; BBC and others on the item), else a media:content that's an image.
     */
    private static String itemImage(SyndEntry e, URI base) {
        List<org.jdom2.Element> media = new ArrayList<>();
        for (org.jdom2.Element el : e.getForeignMarkup()) {
            if ("image".equals(el.getName()) && el.getAttributeValue("href") != null) {
                String art = absolute(base, el.getAttributeValue("href"));
                if (art != null) {
                    return art;
                }
            }
            media.add(el);
            if ("group".equals(el.getName())) {
                media.addAll(el.getChildren());
            }
        }
        String best = null;
        int bestWidth = -1;
        for (org.jdom2.Element el : media) {
            if ("thumbnail".equals(el.getName())) {
                String url = absolute(base, el.getAttributeValue("url"));
                int width = number(el.getAttributeValue("width"));
                if (url != null && width > bestWidth) {
                    best = url;
                    bestWidth = width;
                }
            }
        }
        if (best != null) {
            return best;
        }
        for (org.jdom2.Element el : media) {
            String type = el.getAttributeValue("type", "");
            if ("content".equals(el.getName()) && ("image".equals(el.getAttributeValue("medium")) || type.startsWith("image/"))) {
                String url = absolute(base, el.getAttributeValue("url"));
                if (url != null) {
                    return url;
                }
            }
        }
        return null;
    }

    private static int number(String s) {
        try {
            return s == null ? 0 : Integer.parseInt(s.strip());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    /** YouTube (and other Media RSS feeds) put the description in media:group/media:description. */
    private static String mediaDescription(SyndEntry e) {
        for (org.jdom2.Element el : e.getForeignMarkup()) {
            if ("description".equals(el.getName())) {
                return el.getText();
            }
            for (org.jdom2.Element child : el.getChildren()) {
                if ("description".equals(child.getName())) {
                    return child.getText();
                }
            }
        }
        return null;
    }

    /** "ana@site (Ana)" → "Ana"; a bare email address is left out. */
    private static String author(String raw) {
        String a = text(raw);
        if (a.contains("@")) {
            int open = a.indexOf('(');
            int close = a.lastIndexOf(')');
            a = open >= 0 && close > open ? a.substring(open + 1, close).strip() : "";
        }
        return a.isEmpty() ? null : cut(a, 200);
    }

    /** HTML (or plain text with entities) as plain text on one line. */
    static String text(String html) {
        if (html == null || html.isBlank()) {
            return "";
        }
        Document doc = Jsoup.parseBodyFragment(html);
        doc.select("script, style, noscript, template, iframe, object, embed, svg, math").remove();
        return doc.text().replace(' ', ' ').replaceAll("\\s+", " ").strip();
    }

    /** Plain text made safe to treat as HTML (JSON Feed's titles and summaries are plain text): "<" stays "<". */
    static String escape(String plain) {
        return plain == null ? "" : org.jsoup.nodes.Entities.escape(plain);
    }

    /** At most {@code max} characters, cut at a word with "…". */
    static String cut(String s, int max) {
        if (s.length() <= max) {
            return s;
        }
        int end = s.lastIndexOf(' ', max - 1);
        if (end < max / 2) {
            end = max - 1;
        }
        return s.substring(0, end).strip() + "…";
    }

    /** An absolute http(s) address, or null. */
    static String absoluteUrl(URI base, String link) {
        return absolute(base, link);
    }

    private static String absolute(URI base, String link) {
        if (link == null || link.isBlank()) {
            return null;
        }
        try {
            URI u = base.resolve(link.strip().replace(" ", "%20"));
            String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https") || u.getHost() == null || u.toString().length() > 2048) {
                return null;
            }
            return u.toString();
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    /** Removes utm_* and other click-tracking parameters, keeping the rest as written. */
    public static String cleanLink(String url) {
        int hash = url.indexOf('#');
        String fragment = hash >= 0 ? url.substring(hash) : "";
        String rest = hash >= 0 ? url.substring(0, hash) : url;
        int q = rest.indexOf('?');
        if (q < 0) {
            return url;
        }
        List<String> kept = new ArrayList<>();
        for (String param : rest.substring(q + 1).split("&")) {
            String name = param.split("=", 2)[0].toLowerCase(Locale.ROOT);
            if (!param.isEmpty() && !name.startsWith("utm_") && !TRACKING.contains(name)) {
                kept.add(param);
            }
        }
        return rest.substring(0, q) + (kept.isEmpty() ? "" : "?" + String.join("&", kept)) + fragment;
    }

    /** The feeds a web page names in its head (RSS, Atom and JSON Feed), as absolute addresses. */
    public static List<URI> feedLinks(byte[] html, URI page) {
        try {
            Document doc = Jsoup.parse(new ByteArrayInputStream(html), null, page.toString());
            List<URI> out = new ArrayList<>();
            for (Element l : doc.select("link[rel~=(?i)\\balternate\\b][type~=(?i)^application/((rss|atom)\\+xml|feed\\+json|json)$][href]")) {
                String abs = absolute(page, l.attr("href"));
                if (abs != null && out.size() < 3) {
                    URI u = URI.create(abs);
                    if (!out.contains(u)) {
                        out.add(u);
                    }
                }
            }
            return out;
        } catch (IOException | IllegalArgumentException e) {
            return List.of();
        }
    }
}
