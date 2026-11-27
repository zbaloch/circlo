package com.circlo.server.reading;

import com.rometools.rome.feed.synd.SyndContent;
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

    /** A feed. {@code siteUrl} is the site it belongs to, if it says. */
    public record Feed(String title, String siteUrl, List<Item> items) {}

    /** One article: {@code guid} identifies it within its feed. */
    public record Item(String guid, String url, String title, String summary, String author, Instant published) {}

    /** Not a feed Circlo can read (HTML, broken XML, a doctype). */
    public static final class NotAFeed extends Exception {
        NotAFeed() {
            super("not_a_feed", null, false, false);
        }
    }

    private FeedParser() {}

    public static Feed parse(byte[] body, URI base, Instant now) throws NotAFeed {
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
        return new Feed(title, site, items);
    }

    private static Item item(SyndEntry e, URI base, Instant now) {
        String link = e.getLink();
        if (link == null || link.isBlank()) {
            link = e.getLinks().stream().filter(l -> l.getRel() == null || "alternate".equals(l.getRel())).map(SyndLink::getHref)
                    .findFirst().orElse(null);
        }
        String url = absolute(base, link);
        if (url == null) {
            return null;
        }
        url = cleanLink(url);
        String body = e.getDescription() != null ? e.getDescription().getValue() : null;
        if ((body == null || body.isBlank()) && !e.getContents().isEmpty()) {
            body = ((SyndContent) e.getContents().get(0)).getValue();
        }
        if (body == null || body.isBlank()) {
            body = mediaDescription(e);
        }
        String summary = cut(text(body), SUMMARY_MAX);
        String title = cut(text(e.getTitle()), TITLE_MAX);
        if (title.isEmpty()) {
            title = cut(summary, 100);
        }
        if (title.isEmpty()) {
            return null;
        }
        String guid = e.getUri() != null && !e.getUri().isBlank() ? e.getUri().strip() : url;
        Date date = e.getPublishedDate() != null ? e.getPublishedDate() : e.getUpdatedDate();
        Instant published = date == null || date.toInstant().isAfter(now) ? now : date.toInstant();
        return new Item(guid, url, title, summary, author(e.getAuthor()), published);
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

    /** The feeds a web page names in its head (RSS and Atom), as absolute addresses. */
    public static List<URI> feedLinks(byte[] html, URI page) {
        try {
            Document doc = Jsoup.parse(new ByteArrayInputStream(html), null, page.toString());
            List<URI> out = new ArrayList<>();
            for (Element l : doc.select("link[rel~=(?i)\\balternate\\b][type~=(?i)^application/(rss|atom)\\+xml$][href]")) {
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
