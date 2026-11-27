package com.circlo.server.reading;

import java.net.URI;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * JSON Feed (https://jsonfeed.org, versions 1 and 1.1), the JSON cousin of RSS that some blogs and micro.blog use.
 * Read into the same items as RSS and Atom (FeedParser.item): HTML content becomes blocks, plain-text content becomes
 * paragraphs, an audio attachment makes a podcast episode, and the item's image is its picture.
 */
final class JsonFeed {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final int MAX_ITEMS = 100;

    private JsonFeed() {}

    /** Whether a body is JSON rather than XML: its first non-space character is "{". */
    static boolean looksLikeJson(byte[] body) {
        for (int i = 0; i < Math.min(body.length, 1024); i++) {
            byte b = body[i];
            if (b == ' ' || b == '\t' || b == '\r' || b == '\n') {
                continue;
            }
            // A UTF-8 byte order mark
            if (i == 0 && body.length >= 3 && (b & 0xFF) == 0xEF && (body[1] & 0xFF) == 0xBB && (body[2] & 0xFF) == 0xBF) {
                i += 2;
                continue;
            }
            return b == '{';
        }
        return false;
    }

    static FeedParser.Feed parse(byte[] body, URI base, Instant now) throws FeedParser.NotAFeed {
        JsonNode root;
        try {
            root = JSON.readTree(body);
        } catch (JacksonException e) {
            throw new FeedParser.NotAFeed();
        }
        // A JSON Feed says so in "version" (https://jsonfeed.org/version/1 or /1.1) and has items.
        if (root == null || !root.isObject() || !string(root, "version").startsWith("https://jsonfeed.org/version/")
                || !root.path("items").isArray()) {
            throw new FeedParser.NotAFeed();
        }
        String site = FeedParser.absoluteUrl(base, string(root, "home_page_url"));
        List<FeedParser.Item> items = new ArrayList<>();
        for (JsonNode i : root.path("items")) {
            if (items.size() == MAX_ITEMS) {
                break;
            }
            if (i.isObject()) {
                FeedParser.Item item = item(i, base, now);
                if (item != null) {
                    items.add(item);
                }
            }
        }
        items.sort(Comparator.comparing(FeedParser.Item::published).reversed());
        String title = FeedParser.cut(FeedParser.text(FeedParser.escape(string(root, "title"))), 200);
        if (title.isEmpty()) {
            title = site != null ? URI.create(site).getHost() : base.getHost();
        }
        String icon = FeedParser.absoluteUrl(base, string(root, "icon"));
        if (icon == null) {
            icon = FeedParser.absoluteUrl(base, string(root, "favicon"));
        }
        return new FeedParser.Feed(title, site, icon, items);
    }

    private static FeedParser.Item item(JsonNode i, URI base, Instant now) {
        String url = FeedParser.absoluteUrl(base, string(i, "url"));
        if (url == null) {
            url = FeedParser.absoluteUrl(base, string(i, "external_url"));
        }
        // "id" is a string, but some feeds give a number.
        JsonNode idNode = i.path("id");
        String id = idNode.isString() || idNode.isNumber() ? idNode.asString() : null;
        String html = string(i, "content_html");
        String content = !html.isBlank() ? html : paragraphs(string(i, "content_text"));
        String summary = !string(i, "summary").isBlank() ? FeedParser.escape(string(i, "summary")) : content;
        Instant date = date(string(i, "date_published"));
        if (date == null) {
            date = date(string(i, "date_modified"));
        }
        String image = FeedParser.absoluteUrl(base, string(i, "image"));
        if (image == null) {
            image = FeedParser.absoluteUrl(base, string(i, "banner_image"));
        }
        return FeedParser.item(id, url, FeedParser.escape(string(i, "title")), summary, content, author(i), date, audio(i, base), image, now);
    }

    /** The first attachment that's audio: a podcast episode. */
    private static FeedParser.Audio audio(JsonNode i, URI base) {
        for (JsonNode a : i.path("attachments")) {
            String url = FeedParser.absoluteUrl(base, string(a, "url"));
            if (url == null) {
                continue;
            }
            JsonNode seconds = a.path("duration_in_seconds");
            Integer length = seconds.isNumber() && seconds.asDouble() > 0 && seconds.asDouble() < 7 * 24 * 3600 ? (int) seconds.asDouble() : null;
            FeedParser.Audio audio = FeedParser.audio(url, string(a, "mime_type"), length);
            if (audio != null) {
                return audio;
            }
        }
        return null;
    }

    /** Version 1.1's "authors" (the first), else version 1's "author". */
    private static String author(JsonNode i) {
        JsonNode a = i.path("authors").path(0);
        if (!a.isObject()) {
            a = i.path("author");
        }
        String name = FeedParser.cut(FeedParser.text(FeedParser.escape(string(a, "name"))), 200);
        return name.isEmpty() ? null : name;
    }

    private static String string(JsonNode node, String field) {
        JsonNode v = node.path(field);
        return v.isString() ? v.asString() : "";
    }

    private static Instant date(String s) {
        if (s.isBlank()) {
            return null;
        }
        try {
            return OffsetDateTime.parse(s.strip()).toInstant();
        } catch (DateTimeParseException e) {
            return null;
        }
    }

    /** Plain text as HTML paragraphs (one per blank-line-separated block), escaped. */
    static String paragraphs(String text) {
        if (text.isBlank()) {
            return "";
        }
        StringBuilder out = new StringBuilder();
        for (String p : text.strip().split("\\n\\s*\\n")) {
            out.append("<p>").append(FeedParser.escape(p.strip()).replace("\n", "<br>")).append("</p>");
        }
        return out.toString();
    }
}
