package com.circlo.server.reading;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * A feed item's HTML becomes simple blocks the app draws natively (paragraphs with bold, italic, code and links;
 * headings, lists, quotes, code, images, rules). Nothing from the publisher's HTML runs, and tracking goes.
 */
class FeedContentTest {

    private static final URI BASE = URI.create("https://blog.example/posts/1");

    private static List<Map<String, Object>> blocks(String html) {
        return FeedContent.convert(html, BASE).blocks();
    }

    private static Map<String, Object> run(String text) {
        return Map.of("text", text);
    }

    @Test
    void paragraphsWithBoldItalicCodeAndLinks() {
        List<Map<String, Object>> b = blocks("""
                <p>I left <b>Germany</b> at 20 and <i>never</i> stopped. See <a href="/issues/352?utm_source=rss&amp;x=1">a
                person of place</a> and <code>git log</code>.</p>
                <p>Second   paragraph<br>with a break.</p>""");
        assertThat(b).hasSize(2);
        assertThat(b.get(0)).containsEntry("type", "p");
        assertThat(b.get(0).get("runs")).isEqualTo(List.of(
                run("I left "), Map.of("text", "Germany", "b", true), run(" at 20 and "), Map.of("text", "never", "i", true),
                run(" stopped. See "), Map.of("text", "a person of place", "href", "https://blog.example/issues/352?x=1"), run(" and "),
                Map.of("text", "git log", "code", true), run(".")));
        assertThat(b.get(1).get("runs")).isEqualTo(List.of(run("Second paragraph\nwith a break.")));
    }

    @Test
    void headingsListsQuotesCodeAndRules() {
        List<Map<String, Object>> b = blocks("""
                <h2>What I read</h2>
                <ul><li>One <em>thing</em></li><li><p>Two</p></li></ul>
                <ol><li>First</li></ol>
                <blockquote><p>Quoted words.</p><p>More.</p></blockquote>
                <pre><code>let x = 1;
                  x += 2;</code></pre>
                <hr>""");
        assertThat(b).extracting(x -> x.get("type")).containsExactly("h", "list", "list", "quote", "quote", "code", "hr");
        assertThat(b.get(0).get("runs")).isEqualTo(List.of(run("What I read")));
        assertThat(b.get(1)).containsEntry("ordered", false)
                .containsEntry("items", List.of(List.of(run("One "), Map.of("text", "thing", "i", true)), List.of(run("Two"))));
        assertThat(b.get(2)).containsEntry("ordered", true);
        assertThat(b.get(3).get("runs")).isEqualTo(List.of(run("Quoted words.")));
        assertThat(b.get(5)).containsEntry("text", "let x = 1;\n  x += 2;");
    }

    @Test
    void imagesKeepTheirSizeAndTrackingPixelsGo() {
        FeedContent.Result r = FeedContent.convert("""
                <p>Before <img src="/img/photo.jpg" alt="A photo" width="800" height="600"> after</p>
                <img src="https://pixel.wp.com/g.gif?blog=1">
                <img src="https://blog.example/open.gif" width="1" height="1">
                <img src="https://mailer.example/track/open/abc">
                <img src="data:image/png;base64,AAAA">
                <img src="javascript:alert(1)">""", BASE);
        assertThat(r.blocks()).extracting(x -> x.get("type")).containsExactly("p", "img", "p");
        assertThat(r.blocks().get(1)).isEqualTo(Map.of("type", "img", "src", "https://blog.example/img/photo.jpg", "alt", "A photo", "w", 800, "h", 600));
        assertThat(r.images()).isEqualTo(1);
    }

    @Test
    void scriptsStylesFramesAndFormsNeverSurvive() {
        List<Map<String, Object>> b = blocks("""
                <script>steal()</script><style>p{color:red}</style>
                <iframe src="https://evil.example"></iframe>
                <form action="/x"><input name="q"><button>Go</button></form>
                <p onclick="steal()">Safe <a href="javascript:steal()">text</a></p>""");
        assertThat(b).singleElement().satisfies(p -> assertThat(p.get("runs")).isEqualTo(List.of(run("Safe text"))));
    }

    @Test
    void nestedWrappersFlattenAndEmptyBitsVanish() {
        List<Map<String, Object>> b = blocks("""
                <div><div><section><p>  Deep   </p></section></div><p></p><p> </p>
                <figure><img src="https://blog.example/a.png"><figcaption>Caption</figcaption></figure></div>""");
        assertThat(b).extracting(x -> x.get("type")).containsExactly("p", "img", "p");
        assertThat(b.get(0).get("runs")).isEqualTo(List.of(run("Deep")));
        assertThat(b.get(2).get("runs")).isEqualTo(List.of(Map.of("text", "Caption", "i", true)));
    }

    @Test
    void textLengthCountsWhatIsReadable() {
        assertThat(FeedContent.convert("<p>Hello <b>world</b></p><p>Again</p>", BASE).textLength()).isEqualTo("Hello world".length() + "Again".length());
        assertThat(FeedContent.convert("", BASE).blocks()).isEmpty();
        assertThat(FeedContent.convert(null, BASE).blocks()).isEmpty();
    }

    @Test
    void veryLongContentIsCapped() {
        String html = "<p>word</p>".repeat(FeedContent.MAX_BLOCKS + 50);
        assertThat(FeedContent.convert(html, BASE).blocks()).hasSize(FeedContent.MAX_BLOCKS);
    }
}
