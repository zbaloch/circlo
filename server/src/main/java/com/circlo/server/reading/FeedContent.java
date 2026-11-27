package com.circlo.server.reading;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Element;
import org.jsoup.nodes.Node;
import org.jsoup.nodes.TextNode;

/**
 * A feed item's HTML as simple blocks the app draws with its own text styles, so nothing from the publisher runs:
 * paragraphs (runs of text, each optionally bold, italic, code or a link), headings, lists, quotes, code, images and
 * rules. Links are absolute http(s) without tracking parameters; scripts, styles, frames, forms and media embeds go;
 * tracking pixels go. Images keep the publisher's address here: the API hands them out only as signed Circlo links
 * (ReadingImages), so the publisher never sees the reader.
 *
 * <p>JSON shapes: {@code {type:"p"|"h"|"quote", runs:[{text, b?, i?, code?, href?}]}},
 * {@code {type:"list", ordered, items:[[runs]]}}, {@code {type:"code", text}}, {@code {type:"img", src, alt?, w?, h?}},
 * {@code {type:"hr"}}.
 */
public final class FeedContent {

    static final int MAX_BLOCKS = 400;
    static final int MAX_IMAGES = 40;
    static final int MAX_TEXT = 100_000;
    private static final int MAX_CODE = 10_000;

    private static final Set<String> DROP = Set.of("script", "style", "noscript", "template", "iframe", "frame", "frameset", "object",
            "embed", "applet", "svg", "math", "form", "input", "button", "select", "option", "textarea", "label", "canvas", "audio",
            "video", "source", "track", "map", "area", "head", "link", "meta", "base", "title", "dialog");
    private static final Set<String> BLOCK = Set.of("p", "div", "section", "article", "header", "footer", "main", "aside", "nav",
            "figure", "center", "dl", "dt", "dd", "details", "summary", "table", "thead", "tbody", "tfoot", "tr", "address", "hgroup", "body");
    private static final Set<String> HEADINGS = Set.of("h1", "h2", "h3", "h4", "h5", "h6");
    private static final Set<String> BOLD = Set.of("b", "strong");
    private static final Set<String> ITALIC = Set.of("i", "em", "cite", "dfn", "var");
    private static final Set<String> CODE = Set.of("code", "kbd", "samp", "tt");
    /** Hosts that only count opens. */
    private static final Set<String> TRACKER_HOSTS = Set.of("pixel.wp.com", "stats.wordpress.com", "feeds.feedburner.com",
            "feedproxy.google.com", "www.google-analytics.com", "pixel.quantserve.com", "ad.doubleclick.net", "sb.scorecardresearch.com",
            "track.hubspot.com", "pixel.mathtag.com", "www.facebook.com", "pixel.substack.com", "ea.pstmrk.it");
    private static final Pattern TRACKER_PATH = Pattern.compile(
            "(?i)(/track(ing)?/open|/open\\.(php|gif|png)|/wf/open|/pixel(\\.gif|\\.png|/|$)|/beacon|/~r/|/~ff/|/e/o/|/o\\.gif)");

    /** The blocks, how much readable text they hold, and how many images. */
    public record Result(List<Map<String, Object>> blocks, int textLength, int images) {}

    private record Marks(boolean b, boolean i, boolean code, String href) {
        static final Marks NONE = new Marks(false, false, false, null);
    }

    private FeedContent() {}

    public static Result convert(String html, URI base) {
        if (html == null || html.isBlank()) {
            return new Result(List.of(), 0, 0);
        }
        Builder out = new Builder(base);
        out.walk(Jsoup.parseBodyFragment(html, base.toString()).body(), Marks.NONE);
        out.flush();
        return new Result(out.blocks, out.text, out.images);
    }

    private static final class Builder {
        final URI base;
        final List<Map<String, Object>> blocks = new ArrayList<>();
        List<Map<String, Object>> runs = new ArrayList<>();
        String kind = "p";
        int text;
        int images;

        Builder(URI base) {
            this.base = base;
        }

        boolean full() {
            return blocks.size() >= MAX_BLOCKS || text >= MAX_TEXT;
        }

        void add(Map<String, Object> block) {
            if (!full()) {
                blocks.add(block);
            }
        }

        void walk(Node node, Marks m) {
            for (Node child : node.childNodes()) {
                if (full()) {
                    return;
                }
                if (child instanceof TextNode t) {
                    append(t.getWholeText().replaceAll("\\s+", " "), m);
                } else if (child instanceof Element e) {
                    element(e, m);
                }
            }
        }

        void element(Element e, Marks m) {
            String tag = e.normalName();
            if (DROP.contains(tag)) {
                return;
            }
            if (HEADINGS.contains(tag)) {
                flush();
                String was = kind;
                kind = "h";
                walk(e, m);
                flush();
                kind = was;
            } else if (tag.equals("ul") || tag.equals("ol")) {
                flush();
                list(e, tag.equals("ol"));
            } else if (tag.equals("blockquote")) {
                flush();
                String was = kind;
                kind = "quote";
                walk(e, m);
                flush();
                kind = was;
            } else if (tag.equals("pre")) {
                flush();
                String code = e.wholeText().replaceAll("\\s+$", "");
                if (!code.isBlank()) {
                    code = code.length() > MAX_CODE ? code.substring(0, MAX_CODE) : code;
                    text += code.length();
                    add(new LinkedHashMap<>(Map.of("type", "code", "text", code)));
                }
            } else if (tag.equals("img")) {
                image(e);
            } else if (tag.equals("hr")) {
                flush();
                add(new LinkedHashMap<>(Map.of("type", "hr")));
            } else if (tag.equals("br")) {
                append("\n", m);
            } else if (tag.equals("figcaption")) {
                flush();
                walk(e, new Marks(m.b(), true, m.code(), m.href()));
                flush();
            } else if (tag.equals("td") || tag.equals("th")) {
                walk(e, m);
                append(" ", m);
            } else if (BLOCK.contains(tag) || tag.equals("li")) {
                flush();
                walk(e, m);
                flush();
            } else if (tag.equals("a")) {
                String href = link(e.attr("href"));
                walk(e, new Marks(m.b(), m.i(), m.code(), href != null ? href : m.href()));
            } else if (BOLD.contains(tag)) {
                walk(e, new Marks(true, m.i(), m.code(), m.href()));
            } else if (ITALIC.contains(tag)) {
                walk(e, new Marks(m.b(), true, m.code(), m.href()));
            } else if (CODE.contains(tag)) {
                walk(e, new Marks(m.b(), m.i(), true, m.href()));
            } else {
                walk(e, m); // span, u, mark, small, sup, sub, abbr, s, del, q, time, font and anything unknown
            }
        }

        /** A list: each item's text as runs. A list inside an item becomes its own list after it. */
        void list(Element e, boolean ordered) {
            List<List<Map<String, Object>>> items = new ArrayList<>();
            List<Element> nested = new ArrayList<>();
            for (Element li : e.children()) {
                if (!li.normalName().equals("li")) {
                    continue;
                }
                Builder item = new Builder(base);
                for (Node n : li.childNodes()) {
                    if (n instanceof Element c && (c.normalName().equals("ul") || c.normalName().equals("ol"))) {
                        nested.add(c);
                    } else if (n instanceof Element c && (BLOCK.contains(c.normalName()) || c.normalName().equals("li"))) {
                        item.walk(c, Marks.NONE);
                        item.append(" ", Marks.NONE);
                    } else if (n instanceof Element c) {
                        item.element(c, Marks.NONE);
                    } else if (n instanceof TextNode t) {
                        item.append(t.getWholeText().replaceAll("\\s+", " "), Marks.NONE);
                    }
                }
                List<Map<String, Object>> runs = trim(item.runs);
                if (!runs.isEmpty()) {
                    items.add(runs);
                    for (Map<String, Object> r : runs) {
                        text += ((String) r.get("text")).length();
                    }
                }
            }
            if (!items.isEmpty()) {
                Map<String, Object> block = new LinkedHashMap<>();
                block.put("type", "list");
                block.put("ordered", ordered);
                block.put("items", items);
                add(block);
            }
            for (Element n : nested) {
                list(n, n.normalName().equals("ol"));
            }
        }

        void image(Element e) {
            String src = FeedParser.absoluteUrl(base, e.attr("src").isBlank() ? e.attr("data-src") : e.attr("src"));
            Integer w = size(e.attr("width"));
            Integer h = size(e.attr("height"));
            if (src == null || images >= MAX_IMAGES || isTracker(src, e)) {
                return;
            }
            flush();
            Map<String, Object> block = new LinkedHashMap<>();
            block.put("type", "img");
            block.put("src", src);
            String alt = e.attr("alt").strip();
            if (!alt.isEmpty()) {
                block.put("alt", FeedParser.cut(alt, 300));
            }
            if (w != null && h != null) {
                block.put("w", w);
                block.put("h", h);
            }
            add(block);
            images++;
        }

        private static boolean isTracker(String src, Element e) {
            String w = e.attr("width").strip();
            String h = e.attr("height").strip();
            if (w.matches("[0-3](px)?") || h.matches("[0-3](px)?")) {
                return true;
            }
            URI u = URI.create(src);
            String host = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
            return TRACKER_HOSTS.contains(host) || TRACKER_PATH.matcher(u.getRawPath() == null ? "" : u.getRawPath()).find();
        }

        private static Integer size(String v) {
            try {
                int n = Integer.parseInt(v.strip().replace("px", ""));
                return n > 3 && n <= 10_000 ? n : null;
            } catch (NumberFormatException ex) {
                return null;
            }
        }

        private String link(String href) {
            if (href == null || href.isBlank() || href.startsWith("#")) {
                return null;
            }
            String abs = FeedParser.absoluteUrl(base, href);
            return abs == null ? null : FeedParser.cleanLink(abs);
        }

        void append(String s, Marks m) {
            if (s.isEmpty()) {
                return;
            }
            if (!runs.isEmpty()) {
                Map<String, Object> last = runs.get(runs.size() - 1);
                if (sameMarks(last, m)) {
                    last.put("text", last.get("text") + s);
                    return;
                }
            }
            Map<String, Object> run = new LinkedHashMap<>();
            run.put("text", s);
            if (m.b()) {
                run.put("b", true);
            }
            if (m.i()) {
                run.put("i", true);
            }
            if (m.code()) {
                run.put("code", true);
            }
            if (m.href() != null) {
                run.put("href", m.href());
            }
            runs.add(run);
        }

        private static boolean sameMarks(Map<String, Object> run, Marks m) {
            return run.containsKey("b") == m.b() && run.containsKey("i") == m.i() && run.containsKey("code") == m.code()
                    && java.util.Objects.equals(run.get("href"), m.href());
        }

        void flush() {
            List<Map<String, Object>> done = trim(runs);
            runs = new ArrayList<>();
            if (done.isEmpty()) {
                return;
            }
            for (Map<String, Object> r : done) {
                text += ((String) r.get("text")).replace("\n", "").length();
            }
            Map<String, Object> block = new LinkedHashMap<>();
            block.put("type", kind);
            block.put("runs", done);
            add(block);
        }

        /** Without spaces at the start and end, around line breaks, or empty runs. */
        private static List<Map<String, Object>> trim(List<Map<String, Object>> runs) {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> r : runs) {
                String t = ((String) r.get("text")).replaceAll(" *\n *", "\n").replaceAll(" {2,}", " ");
                r.put("text", t);
                out.add(r);
            }
            while (!out.isEmpty()) {
                Map<String, Object> first = out.get(0);
                String t = ((String) first.get("text")).replaceAll("^[\\s]+", "");
                if (t.isEmpty()) {
                    out.remove(0);
                } else {
                    first.put("text", t);
                    break;
                }
            }
            while (!out.isEmpty()) {
                Map<String, Object> last = out.get(out.size() - 1);
                String t = ((String) last.get("text")).replaceAll("[\\s]+$", "");
                if (t.isEmpty()) {
                    out.remove(out.size() - 1);
                } else {
                    last.put("text", t);
                    break;
                }
            }
            out.removeIf(r -> ((String) r.get("text")).isEmpty());
            return out;
        }
    }
}
