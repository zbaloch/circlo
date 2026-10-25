package com.halqo.server.web;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * Fixed-window rate limits held in memory only. Keys are salted SHA-256 hashes (salt random per process), so neither
 * IP addresses nor handle lookups are kept in recognisable form, and nothing here is logged or persisted.
 */
@Component
public class RateLimiter {

    private record Window(long start, int count) {}

    private final Map<String, Window> windows = new ConcurrentHashMap<>();
    private final byte[] salt = Ids.random(32);
    private final Clock clock;

    public RateLimiter() {
        this(Clock.systemUTC());
    }

    RateLimiter(Clock clock) {
        this.clock = clock;
    }

    /** True if the action is allowed; {@code key} is hashed before use. */
    public boolean tryAcquire(String bucket, byte[] key, int limit, long windowMillis) {
        long now = clock.millis();
        String k = bucket + ':' + hash(key);
        Window w = windows.compute(k, (ignored, old) -> {
            if (old == null || now - old.start() >= windowMillis) {
                return new Window(now, 1);
            }
            return new Window(old.start(), old.count() + 1);
        });
        if (windows.size() > 100_000) {
            windows.entrySet().removeIf(e -> now - e.getValue().start() >= windowMillis);
        }
        return w.count() <= limit;
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
