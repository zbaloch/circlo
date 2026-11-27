package com.circlo.server.reading;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/** Which logo a site's page names for a source's tile: never SVG or Safari's mask icon; YouTube's channel picture. */
class SourceIconsTest {

    private static java.util.List<String> icons(String html, String page) {
        return SourceIcons.pageIcons(html.getBytes(StandardCharsets.UTF_8), URI.create(page));
    }

    @Test
    void appleTouchIconFirstThenTheLargestIcon() {
        assertThat(icons("""
                <link rel="mask-icon" href="/star.svg" color="#000">
                <link rel="shortcut icon" href="/favicon.ico?v=5">
                <link rel="icon" type="image/svg+xml" href="/icon.svg">
                <link rel="icon" sizes="32x32" href="/32.png"><link rel="icon" sizes="192x192" href="/192.png">
                <link rel="apple-touch-icon-precomposed" href="/graphics/touch.png">""", "https://blog.example/"))
                .containsExactly("https://blog.example/graphics/touch.png", "https://blog.example/192.png");
        assertThat(icons("<link rel=\"shortcut icon\" href=\"/favicon.ico\">", "https://blog.example/"))
                .containsExactly("https://blog.example/favicon.ico");
        assertThat(icons("<title>none</title>", "https://blog.example/")).isEmpty();
    }

    @Test
    void aYouTubeChannelUsesItsPictureAtTileSize() {
        assertThat(icons("""
                <link rel="icon" href="https://www.youtube.com/s/desktop/img/favicon_144x144.png" sizes="144x144">
                <meta property="og:image" content="https://yt3.googleusercontent.com/abc=s900-c-k-c0x00ffffff-no-rj">""",
                "https://www.youtube.com/channel/UC1"))
                .first().isEqualTo("https://yt3.googleusercontent.com/abc=s176-c-k-c0x00ffffff-no-rj");
    }

    @Test
    void wordPressIconsAreAskedForAtTileSize() {
        assertThat(SourceIcons.larger("https://blog.example/wp-content/uploads/cropped-icon-32x32.png"))
                .isEqualTo("https://blog.example/wp-content/uploads/cropped-icon-192x192.png");
        assertThat(SourceIcons.larger("https://i0.wp.com/s.example/cropped-512x512-1.png?fit=32%2C32&ssl=1"))
                .isEqualTo("https://i0.wp.com/s.example/cropped-512x512-1.png?fit=192%2C192&ssl=1");
        assertThat(SourceIcons.larger("https://dd.example/img/logo.png")).isEqualTo("https://dd.example/img/logo.png");
    }

    @Test
    void onlyWebAddresses() {
        assertThat(icons("<link rel=\"icon\" href=\"data:image/png;base64,AAAA\"><link rel=\"apple-touch-icon\" href=\"javascript:x\">",
                "https://blog.example/")).isEmpty();
    }
}
