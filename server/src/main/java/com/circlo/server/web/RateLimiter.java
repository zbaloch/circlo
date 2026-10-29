package com.circlo.server.web;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.Expiry;
import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.TimeMeter;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import org.springframework.stereotype.Component;

/**
 * Per-instance rate limits: Bucket4j token buckets in a Caffeine cache, held in memory only. Keys are salted SHA-256
 * hashes (salt random per process), so neither IP addresses nor handle lookups are kept in recognisable form, and
 * nothing here is logged or persisted. A bucket is dropped once it has been idle for its window. With several server
 * instances each enforces its own limits; the shared limit lives at the edge (docs/DEPLOYMENT.md, "Rate limiting").
 */
@Component
public class RateLimiter {

    private record Entry(Bucket bucket, long windowNanos) {}

    private final byte[] salt = Ids.random(32);
    private final TimeMeter time;
    private final Cache<String, Entry> buckets;

    public RateLimiter() {
        this(Clock.systemUTC());
    }

    RateLimiter(Clock clock) {
        this.time = new TimeMeter() {
            @Override
            public long currentTimeNanos() {
                return clock.millis() * 1_000_000;
            }

            @Override
            public boolean isWallClockBased() {
                return true;
            }
        };
        this.buckets = Caffeine.newBuilder()
                .ticker(time::currentTimeNanos)
                .maximumSize(200_000)
                .expireAfter(new Expiry<String, Entry>() {
                    @Override
                    public long expireAfterCreate(String key, Entry e, long now) {
                        return e.windowNanos();
                    }

                    @Override
                    public long expireAfterUpdate(String key, Entry e, long now, long current) {
                        return e.windowNanos();
                    }

                    @Override
                    public long expireAfterRead(String key, Entry e, long now, long current) {
                        return e.windowNanos();
                    }
                })
                .build();
    }

    /** Live entries (for tests). */
    long size() {
        buckets.cleanUp();
        return buckets.estimatedSize();
    }

    /** True if the action is allowed; {@code key} is hashed before use. */
    public boolean tryAcquire(String bucket, byte[] key, int limit, long windowMillis) {
        Duration window = Duration.ofMillis(windowMillis);
        Entry e = buckets.get(bucket + ':' + hash(key), k -> new Entry(
                Bucket.builder()
                        .addLimit(Bandwidth.builder().capacity(limit).refillIntervally(limit, window).build())
                        .withCustomTimePrecision(time)
                        .build(),
                window.toNanos()));
        return e.bucket().tryConsume(1);
    }

    private String hash(byte[] key) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(salt);
            md.update(key);
            return java.util.HexFormat.of().formatHex(md.digest(), 0, 16);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
