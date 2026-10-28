package com.circlo.server.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/** Limits work, and nothing about callers (even salted hashes of their IPs) outlives its window by long. */
class RateLimiterTest {

    private static final class MutableClock extends Clock {
        Instant now = Instant.parse("2026-10-27T00:00:00Z");

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    private static byte[] ip(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    @Test
    void limitsPerWindow() {
        RateLimiter r = new RateLimiter(new MutableClock());
        assertThat(r.tryAcquire("auth-ip", ip("203.0.113.7"), 2, 60_000)).isTrue();
        assertThat(r.tryAcquire("auth-ip", ip("203.0.113.7"), 2, 60_000)).isTrue();
        assertThat(r.tryAcquire("auth-ip", ip("203.0.113.7"), 2, 60_000)).isFalse();
        assertThat(r.tryAcquire("auth-ip", ip("198.51.100.1"), 2, 60_000)).isTrue();
    }

    @Test
    void forgetsCallersOnceTheirWindowHasPassed() {
        MutableClock clock = new MutableClock();
        RateLimiter r = new RateLimiter(clock);
        for (int i = 0; i < 50; i++) {
            r.tryAcquire("auth-ip", ip("203.0.113." + i), 10, 60_000);
        }
        assertThat(r.size()).isEqualTo(50);
        clock.now = clock.now.plus(Duration.ofSeconds(61));
        r.tryAcquire("auth-ip", ip("198.51.100.1"), 10, 60_000);
        assertThat(r.size()).isEqualTo(1);
    }
}
