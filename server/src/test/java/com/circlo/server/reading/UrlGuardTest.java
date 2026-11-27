package com.circlo.server.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.InetAddress;
import java.net.URI;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Circlo fetches addresses people type, so it must never be pointed at its own network (server-side request forgery):
 * only http and https to public addresses, checked again after every redirect (FeedHttp).
 */
class UrlGuardTest {

    private static URI check(String url) throws Exception {
        return UrlGuard.check(URI.create(url), false);
    }

    @Test
    void acceptsPublicWebAddresses() throws Exception {
        assertThat(check("https://93.184.216.34/feed.xml")).hasHost("93.184.216.34");
        assertThat(check("http://[2606:2800:220:1:248:1893:25c8:1946]/rss")).hasScheme("http");
    }

    @Test
    void refusesPrivateLoopbackAndCloudMetadataAddresses() {
        for (String url : List.of("http://127.0.0.1/", "http://127.9.9.9:8080/", "http://10.0.0.5/", "http://172.16.3.4/",
                "http://192.168.1.10/", "http://169.254.169.254/latest/meta-data/", "http://100.64.0.1/", "http://0.0.0.0/",
                "http://[::1]/", "http://[fc00::1]/", "http://[fe80::1]/", "http://[::ffff:127.0.0.1]/", "http://224.0.0.1/",
                "http://255.255.255.255/", "http://localhost/")) {
            assertThatThrownBy(() -> check(url)).as(url).isInstanceOf(UrlGuard.Refused.class);
        }
    }

    @Test
    void refusesOtherSchemesAndPasswordsInTheAddress() {
        for (String url : List.of("file:///etc/passwd", "ftp://93.184.216.34/", "gopher://93.184.216.34/", "jar:file:/x!/y",
                "https://user:pw@93.184.216.34/", "https:///nohost", "//93.184.216.34/")) {
            assertThatThrownBy(() -> check(url)).as(url).isInstanceOf(UrlGuard.Refused.class);
        }
    }

    @Test
    void privateAddressesOnlyWhenAllowedForTests() throws Exception {
        assertThat(UrlGuard.check(URI.create("http://127.0.0.1:8123/feed"), true)).hasPort(8123);
        assertThatThrownBy(() -> UrlGuard.check(URI.create("file:///etc/passwd"), true)).isInstanceOf(UrlGuard.Refused.class);
    }

    @Test
    void publicMeansNotInAnyReservedRange() throws Exception {
        assertThat(UrlGuard.isPublic(InetAddress.getByName("8.8.8.8"))).isTrue();
        assertThat(UrlGuard.isPublic(InetAddress.getByName("100.63.255.255"))).isTrue();
        assertThat(UrlGuard.isPublic(InetAddress.getByName("100.128.0.0"))).isTrue();
        assertThat(UrlGuard.isPublic(InetAddress.getByName("198.18.0.1"))).isFalse();
        assertThat(UrlGuard.isPublic(InetAddress.getByName("192.0.0.8"))).isFalse();
        assertThat(UrlGuard.isPublic(InetAddress.getByName("64:ff9b::7f00:1"))).isFalse();
    }

    @Test
    void addsHttpsWhenPeopleTypeJustTheSite() {
        assertThat(UrlGuard.parseInput("stratechery.com")).hasToString("https://stratechery.com");
        assertThat(UrlGuard.parseInput("  http://example.com/feed  ")).hasToString("http://example.com/feed");
        assertThat(UrlGuard.parseInput("feed://example.com/rss")).hasToString("https://example.com/rss");
        assertThat(UrlGuard.parseInput("not a url at all")).isNull();
        assertThat(UrlGuard.parseInput("")).isNull();
        assertThat(UrlGuard.parseInput("javascript:alert(1)")).isNull();
    }
}
