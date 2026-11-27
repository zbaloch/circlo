package com.circlo.server.reading;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.springframework.stereotype.Component;

/**
 * Fetches feeds and pages for Reading: a generic user agent (nothing about who asked), short timeouts, at most
 * {@link #MAX_BYTES}, and redirects followed by hand so each hop passes {@link UrlGuard} first. Sends conditional
 * headers so an unchanged feed costs a 304.
 */
@Component
public class FeedHttp {

    static final int MAX_BYTES = 5 * 1024 * 1024;
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

    /** The fetch failed: refused address, network error, too big, or an error status. No detail is kept. */
    public static final class Failed extends Exception {
        Failed() {
            super("failed", null, false, false);
        }
    }

    private final HttpClient client = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NEVER)
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    private final boolean allowPrivate;

    public FeedHttp(ReadingProperties props) {
        this.allowPrivate = props.allowPrivateHosts();
    }

    public Response get(URI url, String etag, String modified) throws Failed {
        URI at = url;
        try {
            for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
                UrlGuard.check(at, allowPrivate);
                HttpRequest.Builder req = HttpRequest.newBuilder(at)
                        .timeout(Duration.ofSeconds(10))
                        .header("User-Agent", USER_AGENT)
                        .header("Accept", "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5")
                        .GET();
                if (hop == 0 && etag != null) {
                    req.header("If-None-Match", etag);
                }
                if (hop == 0 && modified != null) {
                    req.header("If-Modified-Since", modified);
                }
                HttpResponse<InputStream> res = client.send(req.build(), HttpResponse.BodyHandlers.ofInputStream());
                int status = res.statusCode();
                if (status >= 300 && status < 400 && status != 304) {
                    res.body().close();
                    String location = res.headers().firstValue("Location").orElseThrow(Failed::new);
                    at = at.resolve(location.strip());
                    continue;
                }
                if (status == 304) {
                    res.body().close();
                    return new Response(304, at, null, new byte[0], etag, modified);
                }
                if (status != 200) {
                    res.body().close();
                    throw new Failed();
                }
                byte[] body = readBody(res.body());
                if (body.length > MAX_BYTES) {
                    throw new Failed();
                }
                return new Response(200, at, res.headers().firstValue("Content-Type").orElse(""), body,
                        res.headers().firstValue("ETag").filter(v -> v.length() <= 512).orElse(null),
                        res.headers().firstValue("Last-Modified").filter(v -> v.length() <= 100).orElse(null));
            }
            throw new Failed();
        } catch (UrlGuard.Refused | IOException | IllegalArgumentException e) {
            throw new Failed();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new Failed();
        }
    }

    private static byte[] readBody(InputStream in) throws Failed, InterruptedException {
        CompletableFuture<byte[]> read = CompletableFuture.supplyAsync(() -> {
            try (in) {
                return in.readNBytes(MAX_BYTES + 1);
            } catch (IOException e) {
                throw new java.io.UncheckedIOException(e);
            }
        }, READERS);
        try {
            return read.get(BODY_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException | ExecutionException e) {
            try {
                in.close();
            } catch (IOException ignored) {
                // closing aborts the read
            }
            read.cancel(true);
            throw new Failed();
        }
    }
}
