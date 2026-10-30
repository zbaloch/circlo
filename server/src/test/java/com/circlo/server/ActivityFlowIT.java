package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.circlo.server.crypto.CircloCore;
import com.circlo.server.web.Ids;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;

/**
 * No remote push (owner decision 2026-10-30): the Notifications tab lists replies and likes on my posts, and a phone
 * that opts in checks in the background with a device check token that can only read counts.
 */
class ActivityFlowIT extends IntegrationTest {

    @Autowired
    private CircloCore core;

    private static final byte[] TOKEN = Ids.random(32);

    private UUID epoch(TestApp a) {
        UUID e = Ids.newId();
        call("POST", "/v1/epochs", Map.of("epochId", e.toString()), a.accessToken);
        return e;
    }

    private void befriend(TestApp inviter, TestApp other) {
        byte[] token = Ids.random(32);
        call("POST", "/v1/invites", Map.of("tokenHash", core.inviteTokenHash(token)), inviter.accessToken);
        call("POST", "/v1/invites/redeem", Map.of("token", token), other.accessToken);
        call("POST", "/v1/friends/requests", Map.of("toUserId", inviter.userId.toString(), "epochId", epoch(other).toString(),
                "payload", Ids.random(416)), other.accessToken);
        call("POST", "/v1/friends/" + other.userId + "/accept", Map.of("epochId", epoch(inviter).toString(), "payload", Ids.random(416)),
                inviter.accessToken);
    }

    private String post(TestApp a) {
        String id = Ids.newId().toString();
        call("POST", "/v1/posts", Map.of("postId", id, "epochId", epoch(a).toString(), "keyRef", Ids.random(32), "headerCt", Ids.random(256),
                "media", List.of(), "readTokenHash", core.readTokenHash(TOKEN)), a.accessToken);
        return id;
    }

    private int asReader(String method, String path, Object body, TestApp a) {
        var spec = http().method(org.springframework.http.HttpMethod.valueOf(method)).uri(path).header("Authorization", "Bearer " + a.accessToken)
                .header("X-Circlo-Read-Token", java.util.Base64.getEncoder().encodeToString(TOKEN));
        if (body != null) {
            spec = spec.contentType(org.springframework.http.MediaType.APPLICATION_JSON).body(body);
        }
        return spec.retrieve().onStatus(x -> true, (q, r) -> {}).toBodilessEntity().getStatusCode().value();
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> activity(TestApp a) {
        return (List<Map<String, Object>>) call("GET", "/v1/activity", null, a.accessToken).getBody().get("items");
    }

    private ResponseEntity<Map<String, Object>> pending(String checkToken, Instant since) {
        return http().get().uri("/v1/activity/pending?since=" + since).header("X-Circlo-Check-Token", checkToken)
                .retrieve().onStatus(x -> true, (q, r) -> {}).toEntity(new org.springframework.core.ParameterizedTypeReference<Map<String, Object>>() {});
    }

    @Test
    void notificationsListRepliesAndLikesOnMyPostsFromOthers() {
        TestApp alice = new TestApp(this, "act_alice", "pw").register();
        TestApp bob = new TestApp(this, "act_bob", "pw").register();
        befriend(alice, bob);
        String postId = post(alice);

        assertThat(asReader("PUT", "/v1/posts/" + postId + "/like", null, bob)).isEqualTo(200);
        String replyId = Ids.newId().toString();
        assertThat(asReader("POST", "/v1/posts/" + postId + "/replies", Map.of("replyId", replyId, "ciphertext", Ids.random(64)), bob)).isEqualTo(201);
        // My own reply and like on my own post are not "activity".
        assertThat(asReader("PUT", "/v1/posts/" + postId + "/like", null, alice)).isEqualTo(200);
        assertThat(asReader("POST", "/v1/posts/" + postId + "/replies", Map.of("replyId", Ids.newId().toString(), "ciphertext", Ids.random(64)), alice))
                .isEqualTo(201);

        List<Map<String, Object>> items = activity(alice);
        assertThat(items).extracting(i -> i.get("kind")).containsExactly("reply", "like"); // newest first
        assertThat(items).allSatisfy(i -> {
            assertThat(i.get("postId")).isEqualTo(postId);
            assertThat(i.get("actorId")).isEqualTo(bob.userId.toString());
        });
        assertThat(items.get(0).get("replyId")).isEqualTo(replyId);
        assertThat(activity(bob)).isEmpty();

        // Someone I block drops out of my notifications.
        assertThat(call("POST", "/v1/blocks/" + bob.userId, null, alice.accessToken).getStatusCode().value()).isEqualTo(200);
        assertThat(activity(alice)).isEmpty();
    }

    @Test
    void aCheckTokenReadsOnlyCountsAndDiesWithTheDevice() {
        TestApp alice = new TestApp(this, "chk_alice", "pw").register();
        TestApp bob = new TestApp(this, "chk_bob", "pw").register();
        Instant before = Instant.now().minusSeconds(1);

        // Only for my own device, and only with a session.
        assertThat(call("POST", "/v1/devices/" + alice.deviceId + "/check-token", null, bob.accessToken).getStatusCode().value()).isEqualTo(404);
        var issued = call("POST", "/v1/devices/" + alice.deviceId + "/check-token", null, alice.accessToken);
        assertThat(issued.getStatusCode().value()).isEqualTo(200);
        String checkToken = (String) issued.getBody().get("token");

        befriend(alice, bob); // Bob's request to Alice, which she accepts
        String postId = post(alice);
        asReader("PUT", "/v1/posts/" + postId + "/like", null, bob);
        asReader("POST", "/v1/posts/" + postId + "/replies", Map.of("replyId", Ids.newId().toString(), "ciphertext", Ids.random(64)), bob);
        new TestApp(this, alice.handle, "x").login("pw"); // a sign-in elsewhere

        var counts = pending(checkToken, before);
        assertThat(counts.getStatusCode().value()).isEqualTo(200);
        assertThat(counts.getBody()).containsEntry("replies", 1).containsEntry("likes", 1).containsEntry("signIns", 1)
                .containsKeys("requests", "messages");
        // Counts only: nothing about who, what or which post.
        assertThat(counts.getBody().keySet()).containsExactlyInAnyOrder("requests", "replies", "likes", "messages", "signIns");
        assertThat(pending(checkToken, Instant.now().plusSeconds(60)).getBody()).containsEntry("replies", 0).containsEntry("likes", 0);

        // The token is no session: it can't read anything else.
        assertThat(http().get().uri("/v1/activity").header("Authorization", "Bearer " + checkToken).retrieve()
                .onStatus(x -> true, (q, r) -> {}).toBodilessEntity().getStatusCode().value()).isEqualTo(401);
        assertThat(pending("not-a-token", before).getStatusCode().value()).isEqualTo(401);

        // Turning background checks off, or revoking the device, kills it.
        var again = (String) call("POST", "/v1/devices/" + alice.deviceId + "/check-token", null, alice.accessToken).getBody().get("token");
        assertThat(pending(checkToken, before).getStatusCode().value()).isEqualTo(401); // a new token replaces the old one
        assertThat(call("DELETE", "/v1/devices/" + alice.deviceId + "/check-token", null, alice.accessToken).getStatusCode().value()).isEqualTo(200);
        assertThat(pending(again, before).getStatusCode().value()).isEqualTo(401);
        String third = (String) call("POST", "/v1/devices/" + alice.deviceId + "/check-token", null, alice.accessToken).getBody().get("token");
        assertThat(call("DELETE", "/v1/devices/" + alice.deviceId, null, alice.accessToken).getStatusCode().value()).isEqualTo(200);
        assertThat(pending(third, before).getStatusCode().value()).isEqualTo(401);
    }
}
