package com.circlo.server.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.time.Duration;
import org.junit.jupiter.api.Test;

/**
 * Fetches connect only to public addresses, and only to the ones checked: the resolver the connection uses refuses
 * any host with a private, loopback or link-local address, so DNS can't answer one thing to the check and another to
 * the connection (rebinding).
 */
class FeedHttpTest {

    @Test
    void theConnectionsResolverHandsOutOnlyPublicAddresses() throws Exception {
        FeedHttp.PublicOnlyDns dns = new FeedHttp.PublicOnlyDns(false);
        for (String host : new String[] {"localhost", "127.0.0.1", "10.0.0.8", "169.254.169.254", "192.168.1.1", "::1", "fd00::1"}) {
            assertThatThrownBy(() -> dns.resolve(host)).as(host).isInstanceOf(UnknownHostException.class);
        }
        assertThat(dns.resolve("93.184.215.14")).extracting(a -> a.getHostAddress()).containsExactly("93.184.215.14");
        // Tests (and only tests) may fetch from this machine.
        assertThat(new FeedHttp.PublicOnlyDns(true).resolve("127.0.0.1")).hasSize(1);
    }

    @Test
    void aFeedOnThisMachineIsNeverFetchedForReal() throws Exception {
        HttpServer site = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        site.createContext("/old", ex -> {
            ex.getResponseHeaders().set("Location", "/feed");
            ex.sendResponseHeaders(301, -1);
            ex.close();
        });
        site.createContext("/loop", ex -> {
            ex.getResponseHeaders().set("Location", "/loop");
            ex.sendResponseHeaders(302, -1);
            ex.close();
        });
        site.createContext("/", ex -> {
            byte[] body = "<rss version=\"2.0\"><channel><title>Inside</title></channel></rss>".getBytes();
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        site.start();
        try {
            FeedHttp http = new FeedHttp(new ReadingProperties(false, false, Duration.ofMinutes(30)));
            URI inside = URI.create("http://127.0.0.1:" + site.getAddress().getPort() + "/feed");
            assertThatThrownBy(() -> http.get(inside, null, null)).isInstanceOfSatisfying(FeedHttp.Failed.class, f -> assertThat(f.reached()).isFalse());
            FeedHttp local = new FeedHttp(new ReadingProperties(false, true, Duration.ofMinutes(30)));
            assertThat(local.get(inside, null, null).status()).isEqualTo(200);
            // Redirects are followed (each hop checked), up to five.
            FeedHttp.Response moved = local.get(URI.create("http://127.0.0.1:" + site.getAddress().getPort() + "/old"), null, null);
            assertThat(moved.status()).isEqualTo(200);
            assertThat(moved.url().getPath()).isEqualTo("/feed");
            assertThatThrownBy(() -> local.get(URI.create("http://127.0.0.1:" + site.getAddress().getPort() + "/loop"), null, null))
                    .isInstanceOfSatisfying(FeedHttp.Failed.class, f -> assertThat(f.reached()).isTrue());
        } finally {
            site.stop(0);
        }
    }
}
