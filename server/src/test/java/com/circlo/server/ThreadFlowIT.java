package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.circlo.server.crypto.CircloCore;
import com.circlo.server.web.Ids;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/** Phase 8 server side: encrypted replies and likes, visible only to people who may read the author's posts. */
class ThreadFlowIT extends IntegrationTest {

    @Autowired
    private CircloCore core;

    @Autowired
    private JdbcTemplate jdbc;

    private UUID epoch(TestApp a) {
        UUID e = Ids.newId();
        call("POST", "/v1/epochs", Map.of("epochId", e.toString()), a.accessToken);
        return e;
    }

    private void befriend(TestApp inviter, UUID inviterEpoch, TestApp other) {
        byte[] token = Ids.random(32);
        call("POST", "/v1/invites", Map.of("tokenHash", core.inviteTokenHash(token)), inviter.accessToken);
        call("POST", "/v1/invites/redeem", Map.of("token", token), other.accessToken);
        call("POST", "/v1/friends/requests", Map.of("toUserId", inviter.userId.toString(), "epochId", epoch(other).toString(),
                "payload", Ids.random(160)), other.accessToken);
        call("POST", "/v1/friends/" + other.userId + "/accept", Map.of("epochId", inviterEpoch.toString(), "payload", Ids.random(160)),
                inviter.accessToken);
    }

    /** Every post here uses this read token; the friends in these tests are all in the audience. */
    private static final byte[] TOKEN = Ids.random(32);

    private String post(TestApp a, UUID epoch) {
        String id = Ids.newId().toString();
        call("POST", "/v1/posts", Map.of("postId", id, "epochId", epoch.toString(), "keyRef", Ids.random(32), "headerCt", Ids.random(256),
                "media", List.of(), "readTokenHash", core.readTokenHash(TOKEN)), a.accessToken);
        return id;
    }

    private static String token() {
        return java.util.Base64.getEncoder().encodeToString(TOKEN);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> list(String path, TestApp a) {
        return http().get().uri(path).header("Authorization", "Bearer " + a.accessToken).header("X-Circlo-Read-Token", token())
                .retrieve().body(List.class);
    }

    private int status(String method, String path, Object body, TestApp a) {
        var spec = http().method(org.springframework.http.HttpMethod.valueOf(method)).uri(path).header("Authorization", "Bearer " + a.accessToken)
                .header("X-Circlo-Read-Token", token());
        if (body != null) {
            spec = spec.contentType(org.springframework.http.MediaType.APPLICATION_JSON).body(body);
        }
        return spec.retrieve().onStatus(x -> true, (q, r) -> {}).toBodilessEntity().getStatusCode().value();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> stats(TestApp a, String postId) {
        List<Map<String, Object>> res = http().post().uri("/v1/posts/stats").header("Authorization", "Bearer " + a.accessToken)
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .body(Map.of("items", List.of(Map.of("postId", postId, "readToken", TOKEN)))).retrieve().body(List.class);
        return res.get(0);
    }

    @Test
    void repliesAndLikesForReadersOnly() {
        TestApp alice = new TestApp(this, "thr_alice", "pw").register();
        TestApp bob = new TestApp(this, "thr_bob", "pw").register();
        TestApp carol = new TestApp(this, "thr_carol", "pw").register();
        TestApp eve = new TestApp(this, "thr_eve", "pw").register();
        UUID ae = epoch(alice);
        befriend(alice, ae, bob);
        befriend(alice, ae, carol);
        String postId = post(alice, ae);
        String base = "/v1/posts/" + postId;

        // Bob and Carol reply; Eve (not a friend) can't, and can't see anything.
        String r1 = Ids.newId().toString();
        assertThat(status("POST", base + "/replies", Map.of("replyId", r1, "ciphertext", Ids.random(300)), bob)).isEqualTo(201);
        String r2 = Ids.newId().toString();
        assertThat(status("POST", base + "/replies", Map.of("replyId", r2, "ciphertext", Ids.random(300)), carol)).isEqualTo(201);
        assertThat(status("POST", base + "/replies", Map.of("replyId", Ids.newId().toString(), "ciphertext", Ids.random(300)), eve))
                .isEqualTo(404);
        assertThat(status("GET", base + "/replies", null, eve)).isEqualTo(404);
        // Oversized and duplicate replies are rejected.
        assertThat(status("POST", base + "/replies", Map.of("replyId", Ids.newId().toString(), "ciphertext", Ids.random(9000)), bob))
                .isEqualTo(400);
        assertThat(status("POST", base + "/replies", Map.of("replyId", r1, "ciphertext", Ids.random(300)), bob)).isEqualTo(409);

        List<Map<String, Object>> replies = list(base + "/replies", carol);
        assertThat(replies).extracting(r -> r.get("replyId")).containsExactly(r1, r2);
        assertThat(replies.get(0).get("authorId")).isEqualTo(bob.userId.toString());

        // Likes are idempotent; counts appear on the post view.
        assertThat(status("PUT", base + "/like", null, bob)).isEqualTo(200);
        assertThat(status("PUT", base + "/like", null, bob)).isEqualTo(200);
        assertThat(status("PUT", base + "/like", null, carol)).isEqualTo(200);
        assertThat(status("PUT", base + "/like", null, eve)).isEqualTo(404);
        assertThat(list(base + "/likes", alice)).extracting(l -> l.get("userId"))
                .containsExactlyInAnyOrder(bob.userId.toString(), carol.userId.toString());
        assertThat(stats(bob, postId)).containsEntry("replyCount", 2).containsEntry("likeCount", 2).containsEntry("likedByMe", true);
        assertThat(status("DELETE", base + "/like", null, bob)).isEqualTo(200);
        assertThat(stats(bob, postId)).containsEntry("likeCount", 1).containsEntry("likedByMe", false);

        // Delete: own reply, or any reply on my post; nobody else's.
        assertThat(status("DELETE", base + "/replies/" + r2, null, bob)).isEqualTo(404);
        assertThat(status("DELETE", base + "/replies/" + r1, null, bob)).isEqualTo(200);
        assertThat(status("DELETE", base + "/replies/" + r2, null, alice)).isEqualTo(200);
        assertThat(list(base + "/replies", alice)).isEmpty();
    }

    @Test
    void unfriendingRemovesAccess() {
        TestApp alice = new TestApp(this, "thr_dan", "pw").register();
        TestApp bob = new TestApp(this, "thr_fay", "pw").register();
        UUID ae = epoch(alice);
        befriend(alice, ae, bob);
        String postId = post(alice, ae);
        assertThat(status("PUT", "/v1/posts/" + postId + "/like", null, bob)).isEqualTo(200);
        call("DELETE", "/v1/friends/" + bob.userId, null, alice.accessToken);
        assertThat(status("GET", "/v1/posts/" + postId + "/replies", null, bob)).isEqualTo(404);
        assertThat(status("PUT", "/v1/posts/" + postId + "/like", null, bob)).isEqualTo(404);
    }

    @Test
    void feedMergesMeAndFriendsNewestFirstWithPaging() throws Exception {
        TestApp alice = new TestApp(this, "feed_alice", "pw").register();
        TestApp bob = new TestApp(this, "feed_bob", "pw").register();
        TestApp eve = new TestApp(this, "feed_eve", "pw").register();
        UUID ae = epoch(alice);
        befriend(alice, ae, bob);
        UUID be = epoch(bob);
        UUID ee = epoch(eve);
        java.util.List<String> expected = new java.util.ArrayList<>();
        for (int i = 0; i < 3; i++) {
            expected.add(0, post(alice, ae));
            Thread.sleep(5);
            expected.add(0, post(bob, be));
            Thread.sleep(5);
            post(eve, ee); // a stranger's posts never appear
        }
        List<Map<String, Object>> page1 = list("/v1/feed?limit=4", bob);
        assertThat(page1).extracting(p -> p.get("postId")).containsExactlyElementsOf(expected.subList(0, 4));
        String cursor = (String) page1.get(3).get("createdAt");
        List<Map<String, Object>> page2 = list("/v1/feed?limit=4&before=" + cursor, bob);
        assertThat(page2).extracting(p -> p.get("postId")).containsExactlyElementsOf(expected.subList(4, 6));
        assertThat(page1.get(0)).containsKeys("authorId", "media").doesNotContainKeys("likeCount", "replyCount", "likedByMe");
    }

    /** PLAN.md Phase 8 perf: 500 posts across 50 friends; the server side of a feed page must be far under budget. */
    @Test
    void feedOf500PostsAcross50FriendsIsFast() {
        TestApp me = new TestApp(this, "feed_perf", "pw").register();
        byte[] meId = Ids.bytes(me.userId);
        java.sql.Timestamp now = java.sql.Timestamp.from(java.time.Instant.now());
        for (int f = 0; f < 50; f++) {
            byte[] friend = Ids.bytes(Ids.newId());
            jdbc.update("INSERT INTO users (id, handle_lookup, status, created_at) VALUES (?, ?, 'active', ?)", friend, Ids.random(32), now);
            // Half the friendships have me on each side, as in real data.
            jdbc.update("INSERT INTO friendships (id, user_a, user_b, status, created_at) VALUES (?, ?, ?, 'accepted', ?)",
                    Ids.bytes(Ids.newId()), f % 2 == 0 ? meId : friend, f % 2 == 0 ? friend : meId, now);
            byte[] epoch = Ids.bytes(Ids.newId());
            jdbc.update("INSERT INTO epochs (id, owner_id, created_at, active) VALUES (?, ?, ?, TRUE)", epoch, friend, now);
            for (int p = 0; p < 10; p++) {
                jdbc.update("INSERT INTO posts (id, author_id, epoch_id, key_ref, header_ct, created_at, size_bucket) VALUES (?, ?, ?, ?, ?, ?, 9)",
                        Ids.bytes(Ids.newId()), friend, epoch, Ids.random(32), Ids.random(512),
                        java.sql.Timestamp.from(java.time.Instant.now().minusSeconds(f * 10L + p)));
            }
        }
        list("/v1/feed?limit=50", me); // warm up
        long start = System.nanoTime();
        List<Map<String, Object>> first = list("/v1/feed?limit=50", me);
        long firstMs = (System.nanoTime() - start) / 1_000_000;
        start = System.nanoTime();
        int total = 0;
        String cursor = null;
        for (int page = 0; page < 10 && total < 500; page++) {
            List<Map<String, Object>> rows = list("/v1/feed?limit=200" + (cursor == null ? "" : "&before=" + cursor), me);
            if (rows.isEmpty()) break;
            total += rows.size();
            cursor = (String) rows.get(rows.size() - 1).get("createdAt");
        }
        long allMs = (System.nanoTime() - start) / 1_000_000;
        assertThat(first).hasSize(50);
        assertThat(total).isEqualTo(500);
        System.out.printf("feed perf: first page of 50 in %d ms, all 500 in %d ms%n", firstMs, allMs);
        assertThat(firstMs).isLessThan(500);
        assertThat(allMs).isLessThan(1500);
    }
}
