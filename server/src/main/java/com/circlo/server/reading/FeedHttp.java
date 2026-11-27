package com.circlo.server.reading;

import java.io.IOException;
import java.io.InputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import jakarta.annotation.PreDestroy;
import org.apache.hc.client5.http.DnsResolver;
import org.apache.hc.client5.http.SystemDefaultDnsResolver;
import org.apache.hc.client5.http.classic.methods.HttpGet;
import org.apache.hc.client5.http.config.ConnectionConfig;
import org.apache.hc.client5.http.config.RequestConfig;
import org.apache.hc.client5.http.impl.classic.CloseableHttpClient;
import org.apache.hc.client5.http.impl.classic.HttpClients;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManager;
import org.apache.hc.client5.http.impl.io.PoolingHttpClientConnectionManagerBuilder;
import org.apache.hc.core5.http.ClassicHttpResponse;
import org.apache.hc.core5.http.Header;
import org.apache.hc.core5.http.HttpEntity;
import org.apache.hc.core5.io.CloseMode;
import org.apache.hc.core5.util.Timeout;
import org.springframework.stereotype.Component;

/**
 * Fetches feeds, pages and images for Feeds: a generic user agent (nothing about who asked), short timeouts, at most
 * {@link #MAX_BYTES} (25 MB), and redirects followed by hand so each hop passes {@link UrlGuard} first. Connections go
 * only to the addresses {@link PublicOnlyDns} handed out, all public, so DNS can't be used to point a fetch inside.
 * Sends conditional headers so an unchanged feed costs a 304.
 */
@Component
public class FeedHttp {

    /** Podcast feeds carry their whole archive: 20 MB isn't unusual. FeedParser reads big ones one at a time. */
    static final int MAX_BYTES = 25 * 1024 * 1024;
    /** The whole body must arrive within this, so a site that trickles bytes can't hold a fetch open. */
    private static final Duration BODY_TIMEOUT = Duration.ofSeconds(15);
    private static final ExecutorService READERS = Executors.newVirtualThreadPerTaskExecutor();
    private static final int MAX_REDIRECTS = 5;
    static final String USER_AGENT = "Circlo feed reader (+https://www.hellocirclo.com)";

    /** A response. {@code url} is where it was finally served from, after redirects. */
    public record Response(int status, URI url, String contentType, byte[] body, String etag, String modified) {
        boolean notModified() {
            return status == 304;
        }
    }

    /**
     * A fetch that didn't work. {@code reached}: the site answered (an error status, a redirect loop, too big);
     * otherwise Circlo couldn't get an answer at all (no such host, refused, a certificate it can't trust, a timeout).
     */
    public static final class Failed extends Exception {
        private final boolean reached;

        Failed() {
            this(true);
        }

        Failed(boolean reached) {
            super("failed", null, false, false);
            this.reached = reached;
        }

        public boolean reached() {
            return reached;
        }
    }

    /**
     * Looks a host up and hands out its addresses only if every one is public. The connection is then made to exactly
     * these addresses, so a site can't answer "public" to the check and "private" to the connection (DNS rebinding):
     * UrlGuard checks first for a clear refusal, and this is what actually holds.
     */
    static final class PublicOnlyDns implements DnsResolver {
        private final boolean allowPrivate;

        PublicOnlyDns(boolean allowPrivate) {
            this.allowPrivate = allowPrivate;
        }

        @Override
        public InetAddress[] resolve(String host) throws UnknownHostException {
            InetAddress[] all = SystemDefaultDnsResolver.INSTANCE.resolve(host);
            if (!allowPrivate) {
                for (InetAddress a : all) {
                    if (!UrlGuard.isPublic(a)) {
                        throw new UnknownHostException("not a public address");
                    }
                }
            }
            return all;
        }

        @Override
        public String resolveCanonicalHostname(String host) throws UnknownHostException {
            return SystemDefaultDnsResolver.INSTANCE.resolveCanonicalHostname(host);
        }
    }

    private final CloseableHttpClient client;
    private final boolean allowPrivate;

    public FeedHttp(ReadingProperties props) {
        this.allowPrivate = props.allowPrivateHosts();
        PoolingHttpClientConnectionManager connections = PoolingHttpClientConnectionManagerBuilder.create()
                .setDnsResolver(new PublicOnlyDns(allowPrivate))
                .setDefaultConnectionConfig(ConnectionConfig.custom().setConnectTimeout(Timeout.ofSeconds(5)).setSocketTimeout(Timeout.ofSeconds(10)).build())
                .setMaxConnTotal(64)
                .setMaxConnPerRoute(4)
                .build();
        // No proxy, no cookies, no retries; redirects are followed by hand (each hop checked).
        this.client = HttpClients.custom()
                .setConnectionManager(connections)
                .disableRedirectHandling()
                .disableCookieManagement()
                .disableAutomaticRetries()
                .setDefaultRequestConfig(RequestConfig.custom().setResponseTimeout(Timeout.ofSeconds(10)).build())
                .build();
    }

    @PreDestroy
    void close() {
        client.close(CloseMode.IMMEDIATE);
    }

    private static final String FEED_ACCEPT =
            "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5";
    private static final String IMAGE_ACCEPT = "image/avif, image/webp, image/png, image/jpeg, image/gif;q=0.9, image/x-icon;q=0.8";
    /** Article images (ReadingImageController). */
    static final int MAX_IMAGE_BYTES = 10 * 1024 * 1024;

    public Response get(URI url, String etag, String modified) throws Failed {
        return fetch(url, etag, modified, FEED_ACCEPT, MAX_BYTES);
    }

    /** An article image or a source's logo: no conditional headers, at most 10 MB. */
    public Response image(URI url) throws Failed {
        return fetch(url, null, null, IMAGE_ACCEPT, MAX_IMAGE_BYTES);
    }

    private Response fetch(URI url, String etag, String modified, String accept, int maxBytes) throws Failed {
        URI at = url;
        try {
            for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
                UrlGuard.check(at, allowPrivate);
                HttpGet get = new HttpGet(at);
                get.setHeader("User-Agent", USER_AGENT);
                get.setHeader("Accept", accept);
                if (hop == 0 && etag != null) {
                    get.setHeader("If-None-Match", etag);
                }
                if (hop == 0 && modified != null) {
                    get.setHeader("If-Modified-Since", modified);
                }
                ClassicHttpResponse res = client.executeOpen(null, get, null);
                // Anything not read to the end (a redirect, a 304, an error, too big, too slow) drops its connection.
                boolean used = false;
                try {
                    int status = res.getCode();
                    if (status >= 300 && status < 400 && status != 304) {
                        Header location = res.getFirstHeader("Location");
                        if (location == null) {
                            throw new Failed();
                        }
                        at = at.resolve(location.getValue().strip());
                        continue;
                    }
                    if (status == 304) {
                        return new Response(304, at, null, new byte[0], etag, modified);
                    }
                    if (status != 200) {
                        throw new Failed();
                    }
                    HttpEntity entity = res.getEntity();
                    byte[] body = entity == null ? new byte[0] : readBody(entity.getContent(), maxBytes, get::cancel);
                    if (body.length > maxBytes) {
                        throw new Failed();
                    }
                    used = true;
                    return new Response(200, at, header(res, "Content-Type", 1000, ""), body, header(res, "ETag", 512, null),
                            header(res, "Last-Modified", 100, null));
                } finally {
                    if (!used) {
                        get.cancel();
                    }
                    try {
                        res.close();
                    } catch (IOException e) {
                        // already dropped
                    }
                }
            }
            throw new Failed();
        } catch (UrlGuard.Refused | IOException | IllegalArgumentException e) {
            throw new Failed(false);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new Failed(false);
        }
    }

    private static String header(ClassicHttpResponse res, String name, int max, String otherwise) {
        Header h = res.getFirstHeader(name);
        return h == null || h.getValue().length() > max ? otherwise : h.getValue();
    }

    /** Reads at most {@code maxBytes + 1}; past the time limit, {@code abort} drops the connection mid-read. */
    private static byte[] readBody(InputStream in, int maxBytes, Runnable abort) throws Failed, InterruptedException {
        CompletableFuture<byte[]> read = CompletableFuture.supplyAsync(() -> {
            try (in) {
                return in.readNBytes(maxBytes + 1);
            } catch (IOException e) {
                throw new java.io.UncheckedIOException(e);
            }
        }, READERS);
        try {
            return read.get(BODY_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException | ExecutionException e) {
            abort.run();
            read.cancel(true);
            throw new Failed(false);
        }
    }
}
