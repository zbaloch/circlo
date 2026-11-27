package com.circlo.server.reading;

import com.circlo.server.web.ApiException;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Set;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Article images, fetched by Circlo so the publisher never sees who reads (owner decision 2026-11-27: keep the
 * no-tracking promise in Feeds too). Signed-out, as an {@code <img>} on the web can't send a token: the signed link
 * (ReadingImages) is the permission, and only Circlo hands those out, inside articles people follow. Only real image
 * types are served (never SVG, which can carry script), with nothing of the publisher's headers but the type; recent
 * images are kept in memory for an hour so a busy article costs the publisher one request. Nothing is logged.
 */
@RestController
public class ReadingImageController {

    /** Raster types phones and browsers draw safely (icons too, for sources' logos); never SVG. */
    static final Set<String> TYPES = Set.of("image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/x-icon",
            "image/vnd.microsoft.icon");

    private record Image(String type, byte[] bytes) {}

    private final ReadingImages images;
    private final FeedHttp http;
    private final Cache<String, Image> recent = Caffeine.newBuilder()
            .maximumWeight(64L * 1024 * 1024)
            .weigher((String k, Image v) -> v.bytes().length + k.length())
            .expireAfterWrite(Duration.ofHours(1))
            .build();

    public ReadingImageController(ReadingImages images, FeedHttp http) {
        this.images = images;
        this.http = http;
    }

    @GetMapping("/v1/reading/image")
    public ResponseEntity<byte[]> image(@RequestParam(name = "u", required = false) String u, @RequestParam(name = "e", required = false) String e,
            @RequestParam(name = "s", required = false) String s) {
        String url = images.verify(u, e, s, Instant.now()).orElseThrow(ApiException::notFound);
        Image img = recent.getIfPresent(url);
        if (img == null) {
            img = fetch(url);
            recent.put(url, img);
        }
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(img.type()))
                .cacheControl(CacheControl.maxAge(Duration.ofDays(1)).cachePublic())
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Security-Policy", "default-src 'none'")
                .body(img.bytes());
    }

    /** The response's image type, if it's one Circlo serves and has something in it; else null. */
    static String type(FeedHttp.Response res) {
        String type = res.contentType() == null ? "" : res.contentType().split(";")[0].strip().toLowerCase(Locale.ROOT);
        return TYPES.contains(type) && res.body().length > 0 ? type : null;
    }

    private Image fetch(String url) {
        try {
            FeedHttp.Response res = http.image(URI.create(url));
            String type = type(res);
            if (type == null) {
                throw ApiException.notFound();
            }
            return new Image(type, res.body());
        } catch (FeedHttp.Failed | IllegalArgumentException ex) {
            throw ApiException.notFound();
        }
    }
}
