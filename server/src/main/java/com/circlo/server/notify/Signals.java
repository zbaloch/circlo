package com.circlo.server.notify;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.async.DeferredResult;

/**
 * Live updates: a per-person version that moves whenever something changes for them (a reply, like, message, request),
 * and the apps waiting on it (GET /v1/events). Only "something changed" is signalled; the app then fetches what it may
 * see through the usual endpoints. Kept in memory: after a restart versions start from the clock, so every waiting app
 * simply refreshes once.
 */
@Component
public class Signals {

    private final Cache<UUID, Long> versions = Caffeine.newBuilder().expireAfterAccess(Duration.ofDays(1)).build();
    private final Map<UUID, Set<DeferredResult<Map<String, Long>>>> waiting = new ConcurrentHashMap<>();

    public long version(UUID user) {
        return versions.get(user, k -> System.currentTimeMillis());
    }

    public void bump(UUID user) {
        long v = versions.asMap().merge(user, System.currentTimeMillis(), (old, now) -> Math.max(old + 1, now));
        Set<DeferredResult<Map<String, Long>>> set = waiting.remove(user);
        if (set != null) {
            set.forEach(r -> r.setResult(Map.of("version", v)));
        }
    }

    /** Answers at once if the version isn't `since`; otherwise when it changes or the wait times out. */
    public DeferredResult<Map<String, Long>> await(UUID user, long since, long timeoutMs) {
        DeferredResult<Map<String, Long>> r = new DeferredResult<>(timeoutMs);
        r.onTimeout(() -> r.setResult(Map.of("version", version(user))));
        r.onCompletion(() -> waiting.computeIfPresent(user, (k, set) -> {
            set.remove(r);
            return set.isEmpty() ? null : set;
        }));
        waiting.computeIfAbsent(user, k -> ConcurrentHashMap.newKeySet()).add(r);
        long now = version(user);
        if (now != since) {
            r.setResult(Map.of("version", now));
        }
        return r;
    }
}
