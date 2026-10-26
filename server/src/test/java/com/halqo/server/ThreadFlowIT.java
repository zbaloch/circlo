package com.halqo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.halqo.server.crypto.HalqoCore;
import com.halqo.server.web.Ids;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** Phase 8 server side: encrypted replies and likes, visible only to people who may read the author's posts. */
class ThreadFlowIT extends IntegrationTest {

    @Autowired
    private HalqoCore core;

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

    private String post(TestApp a, UUID epoch) {
        String id = Ids.newId().toString();
        call("POST", "/v1/posts", Map.of("postId", id, "epochId", epoch.toString(), "keyRef", Ids.random(32), "headerCt", Ids.random(256),
                "media", List.of()), a.accessToken);
        return id;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> list(String path, TestApp a) {
        return http().get().uri(path).header("Authorization", "Bearer " + a.accessToken).retrieve().body(List.class);
    }

    private int status(String method, String path, Object body, TestApp a) {
        return call(method, path, body, a.accessToken).getStatusCode().value();
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
        Map<String, Object> view = list("/v1/users/" + alice.userId + "/posts", bob).get(0);
        assertThat(view).containsEntry("replyCount", 2).containsEntry("likeCount", 2).containsEntry("likedByMe", true);
        assertThat(status("DELETE", base + "/like", null, bob)).isEqualTo(200);
        assertThat(list("/v1/users/" + alice.userId + "/posts", bob).get(0)).containsEntry("likeCount", 1).containsEntry("likedByMe", false);

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
}
