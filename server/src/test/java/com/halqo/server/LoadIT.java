package com.halqo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.halqo.server.crypto.HalqoCore;
import com.halqo.server.web.Ids;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * PLAN.md Phase 12 load test. Not part of `mvn verify`; run with
 * {@code mvn verify -Dhalqo.excludedGroups= -Dit.test=LoadIT} (optional -Dhalqo.load.seconds, -Dhalqo.load.clients).
 * Real accounts log in through OPAQUE concurrently, then many clients mix the calls the app makes most: feed pages,
 * batch stats with read tokens, new posts and likes. Prints p50/p95/p99 per call and fails on errors or slow p95s.
 */
@Tag("load")
class LoadIT extends IntegrationTest {

    @Autowired
    private HalqoCore core;

    @Autowired
    private JdbcTemplate jdbc;

    private static final byte[] TOKEN = Ids.random(32);
    private static final int USERS = Integer.getInteger("halqo.load.users", 24);
    private static final int CLIENTS = Integer.getInteger("halqo.load.clients", 64);
    private static final int SECONDS = Integer.getInteger("halqo.load.seconds", 30);
    private static final int POSTS_PER_USER = 40;

    private final HttpClient client = HttpClient.newBuilder().executor(Executors.newVirtualThreadPerTaskExecutor())
            .connectTimeout(Duration.ofSeconds(5)).build();
    private final Map<String, List<Long>> latencies = new ConcurrentHashMap<>();
    private final Map<String, AtomicInteger> errors = new ConcurrentHashMap<>();

    @Test
    void mixedWorkloadStaysFast() throws Exception {
        // 1. Accounts: real OPAQUE registration and login, all at once.
        List<TestApp> users = Collections.synchronizedList(new ArrayList<>());
        long t0 = System.nanoTime();
        try (ExecutorService pool = Executors.newFixedThreadPool(8)) {
            for (int i = 0; i < USERS; i++) {
                int n = i;
                pool.submit(() -> users.add(new TestApp(this, "load_" + n, "load test pw " + n).register()));
            }
        }
        assertThat(users).hasSize(USERS);
        System.out.printf("load: %d OPAQUE registrations + logins in %d ms%n", USERS, (System.nanoTime() - t0) / 1_000_000);

        // 2. Everyone is friends with everyone and has posts (seeded directly; the content is opaque anyway).
        Timestamp now = Timestamp.from(Instant.now());
        byte[] tokenHash = core.readTokenHash(TOKEN);
        Map<TestApp, byte[]> epochs = new ConcurrentHashMap<>();
        List<String> postIds = Collections.synchronizedList(new ArrayList<>());
        for (TestApp u : users) {
            byte[] epoch = Ids.bytes(Ids.newId());
            jdbc.update("INSERT INTO epochs (id, owner_id, created_at, active) VALUES (?, ?, ?, TRUE)", epoch, Ids.bytes(u.userId), now);
            epochs.put(u, epoch);
            for (int p = 0; p < POSTS_PER_USER; p++) {
                byte[] id = Ids.bytes(Ids.newId());
                jdbc.update("INSERT INTO posts (id, author_id, epoch_id, key_ref, header_ct, created_at, size_bucket, read_token_hash) "
                        + "VALUES (?, ?, ?, ?, ?, ?, 9, ?)", id, Ids.bytes(u.userId), epoch, Ids.random(32), Ids.random(512),
                        Timestamp.from(Instant.now().minusSeconds(p * 60L)), tokenHash);
                postIds.add(Ids.uuid(id).toString());
            }
        }
        for (int a = 0; a < USERS; a++) {
            for (int b = a + 1; b < USERS; b++) {
                jdbc.update("INSERT INTO friendships (id, user_a, user_b, status, created_at) VALUES (?, ?, ?, 'accepted', ?)",
                        Ids.bytes(Ids.newId()), Ids.bytes(users.get(a).userId), Ids.bytes(users.get(b).userId), now);
            }
        }

        // 3. Mixed workload: 70% feed, 15% stats for a page, 10% new post, 5% like.
        String token = Base64.getEncoder().encodeToString(TOKEN);
        long end = System.nanoTime() + SECONDS * 1_000_000_000L;
        AtomicInteger total = new AtomicInteger();
        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int c = 0; c < CLIENTS; c++) {
                TestApp me = users.get(c % USERS);
                pool.submit(() -> {
                    ThreadLocalRandom rnd = ThreadLocalRandom.current();
                    while (System.nanoTime() < end) {
                        int roll = rnd.nextInt(100);
                        if (roll < 70) {
                            send("feed", me, "GET", "/v1/feed?limit=50", null, null);
                        } else if (roll < 85) {
                            StringBuilder items = new StringBuilder();
                            for (int i = 0; i < 50; i++) {
                                items.append(i == 0 ? "" : ",").append("{\"postId\":\"").append(postIds.get(rnd.nextInt(postIds.size())))
                                        .append("\",\"readToken\":\"").append(token).append("\"}");
                            }
                            send("stats", me, "POST", "/v1/posts/stats", "{\"items\":[" + items + "]}", null);
                        } else if (roll < 95) {
                            String body = "{\"postId\":\"" + Ids.newId() + "\",\"epochId\":\"" + Ids.uuid(epochs.get(me)) + "\",\"keyRef\":\""
                                    + b64(Ids.random(32)) + "\",\"headerCt\":\"" + b64(Ids.random(512)) + "\",\"media\":[],\"readTokenHash\":\""
                                    + b64(tokenHash) + "\"}";
                            send("post", me, "POST", "/v1/posts", body, null);
                        } else {
                            send("like", me, "PUT", "/v1/posts/" + postIds.get(rnd.nextInt(postIds.size())) + "/like", null, token);
                        }
                        total.incrementAndGet();
                    }
                });
            }
        }

        System.out.printf("load: %d clients, %d s, %d requests (%.0f/s)%n", CLIENTS, SECONDS, total.get(), total.get() / (double) SECONDS);
        latencies.forEach((op, list) -> {
            List<Long> sorted = new ArrayList<>(list);
            Collections.sort(sorted);
            System.out.printf("load: %-5s n=%-6d p50=%3d ms  p95=%3d ms  p99=%3d ms  errors=%d%n", op, sorted.size(), pct(sorted, 50),
                    pct(sorted, 95), pct(sorted, 99), errors.getOrDefault(op, new AtomicInteger()).get());
        });
        assertThat(errors.values().stream().mapToInt(AtomicInteger::get).sum()).as("errors").isZero();
        assertThat(pct(sorted("feed"), 95)).as("feed p95 ms").isLessThan(500);
        assertThat(pct(sorted("stats"), 95)).as("stats p95 ms").isLessThan(500);
        assertThat(pct(sorted("post"), 95)).as("post p95 ms").isLessThan(500);
    }

    private void send(String op, TestApp me, String method, String path, String json, String readToken) {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).timeout(Duration.ofSeconds(30))
                .header("Authorization", "Bearer " + me.accessToken)
                .method(method, json == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json));
        if (json != null) {
            b.header("Content-Type", "application/json");
        }
        if (readToken != null) {
            b.header("X-Halqo-Read-Token", readToken);
        }
        long start = System.nanoTime();
        try {
            int status = client.send(b.build(), HttpResponse.BodyHandlers.discarding()).statusCode();
            latencies.computeIfAbsent(op, k -> Collections.synchronizedList(new ArrayList<>())).add((System.nanoTime() - start) / 1_000_000);
            if (status >= 300) {
                errors.computeIfAbsent(op, k -> new AtomicInteger()).incrementAndGet();
            }
        } catch (Exception e) {
            errors.computeIfAbsent(op, k -> new AtomicInteger()).incrementAndGet();
        }
    }

    private List<Long> sorted(String op) {
        List<Long> s = new ArrayList<>(latencies.getOrDefault(op, List.of()));
        Collections.sort(s);
        return s;
    }

    private static long pct(List<Long> sorted, int p) {
        return sorted.isEmpty() ? 0 : sorted.get(Math.min(sorted.size() - 1, (int) Math.ceil(p / 100.0 * sorted.size()) - 1));
    }

    private static String b64(byte[] b) {
        return Base64.getEncoder().encodeToString(b);
    }
}
