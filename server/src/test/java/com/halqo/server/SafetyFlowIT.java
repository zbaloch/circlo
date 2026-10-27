package com.halqo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.halqo.server.crypto.HalqoCore;
import com.halqo.server.storage.S3Properties;
import com.halqo.server.web.Ids;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import software.amazon.awssdk.services.s3.S3Client;

/** Phase 11: read tokens gate replies/likes/counts; blocks; account deletion leaves no trace. */
class SafetyFlowIT extends IntegrationTest {

    @Autowired
    private HalqoCore core;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private S3Client s3;

    @Autowired
    private S3Properties s3Props;

    private final HttpClient httpClient = HttpClient.newHttpClient();

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
                "payload", Ids.random(160)), other.accessToken);
        call("POST", "/v1/friends/" + other.userId + "/accept", Map.of("epochId", epoch(inviter).toString(), "payload", Ids.random(160)),
                inviter.accessToken);
    }

    /** Status of a call that sends the post's read token (or none). */
    private int withToken(String method, String path, Object body, String access, byte[] readToken) {
        var spec = http().method(org.springframework.http.HttpMethod.valueOf(method)).uri(path).header("Authorization", "Bearer " + access);
        if (readToken != null) {
            spec = spec.header("X-Halqo-Read-Token", Base64.getEncoder().encodeToString(readToken));
        }
        if (body != null) {
            spec = spec.contentType(MediaType.APPLICATION_JSON).body(body);
        }
        return spec.retrieve().onStatus(s -> true, (q, r) -> {}).toBodilessEntity().getStatusCode().value();
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> stats(String access, String postId, byte[] readToken) {
        return http().post().uri("/v1/posts/stats").header("Authorization", "Bearer " + access).contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("items", List.of(Map.of("postId", postId, "readToken", readToken)))).retrieve().body(List.class);
    }

    @Test
    void onlyTheAudienceSeesRepliesLikesAndCounts() {
        TestApp alice = new TestApp(this, "rt_alice", "pw").register();
        TestApp bob = new TestApp(this, "rt_bob", "pw").register(); // in the post's audience
        TestApp dave = new TestApp(this, "rt_dave", "pw").register(); // a friend, but not in the audience
        befriend(alice, bob);
        befriend(alice, dave);
        byte[] readToken = Ids.random(32); // apps derive it from the post key; only the audience can
        String postId = Ids.newId().toString();
        assertThat(call("POST", "/v1/posts", Map.of("postId", postId, "epochId", epoch(alice).toString(), "keyRef", Ids.random(32),
                "headerCt", Ids.random(256), "media", List.of(), "readTokenHash", core.readTokenHash(readToken)), alice.accessToken)
                .getStatusCode().value()).isEqualTo(201);
        String base = "/v1/posts/" + postId;

        // Bob (has the token) replies and likes.
        assertThat(withToken("POST", base + "/replies", Map.of("replyId", Ids.newId().toString(), "ciphertext", Ids.random(200)),
                bob.accessToken, readToken)).isEqualTo(201);
        assertThat(withToken("PUT", base + "/like", null, bob.accessToken, readToken)).isEqualTo(200);

        // Dave can't see who interacted, or how many, and can't interact: no token, or a wrong one.
        for (byte[] t : new byte[][] {null, Ids.random(32)}) {
            assertThat(withToken("GET", base + "/replies", null, dave.accessToken, t)).isEqualTo(404);
            assertThat(withToken("GET", base + "/likes", null, dave.accessToken, t)).isEqualTo(404);
            assertThat(withToken("PUT", base + "/like", null, dave.accessToken, t)).isEqualTo(404);
            assertThat(withToken("POST", base + "/replies", Map.of("replyId", Ids.newId().toString(), "ciphertext", Ids.random(200)),
                    dave.accessToken, t)).isEqualTo(404);
        }
        assertThat(stats(dave.accessToken, postId, Ids.random(32))).isEmpty();

        // Counts come only with the token; the feed itself carries none.
        assertThat(stats(alice.accessToken, postId, readToken).get(0)).containsEntry("replyCount", 1).containsEntry("likeCount", 1)
                .containsEntry("likedByMe", false);
        assertThat(stats(bob.accessToken, postId, readToken).get(0)).containsEntry("likedByMe", true);
        @SuppressWarnings("unchecked")
        Map<String, Object> view = (Map<String, Object>) http().get().uri("/v1/feed").header("Authorization", "Bearer " + dave.accessToken)
                .retrieve().body(List.class).get(0);
        assertThat(view).doesNotContainKeys("replyCount", "likeCount", "likedByMe");

        // New posts must carry a read-token hash.
        assertThat(call("POST", "/v1/posts", Map.of("postId", Ids.newId().toString(), "epochId", epoch(alice).toString(), "keyRef",
                Ids.random(32), "headerCt", Ids.random(256), "media", List.of()), alice.accessToken).getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void blockingCutsBothDirections() {
        TestApp alice = new TestApp(this, "bl_alice", "pw").register();
        TestApp mallory = new TestApp(this, "bl_mallory", "pw").register();
        befriend(alice, mallory);
        assertThat(call("POST", "/v1/blocks/" + mallory.userId, Map.of(), alice.accessToken).getStatusCode().value()).isEqualTo(200);

        // The friendship and payloads are gone; Mallory can't see Alice's posts or ask again, by request or invite.
        assertThat(call("GET", "/v1/users/" + alice.userId + "/posts", null, mallory.accessToken).getStatusCode().value()).isEqualTo(404);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM friend_payloads WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)",
                Integer.class, Ids.bytes(alice.userId), Ids.bytes(mallory.userId), Ids.bytes(mallory.userId), Ids.bytes(alice.userId))).isZero();
        byte[] token = Ids.random(32);
        call("POST", "/v1/invites", Map.of("tokenHash", core.inviteTokenHash(token)), alice.accessToken);
        assertThat(call("POST", "/v1/invites/redeem", Map.of("token", token), mallory.accessToken).getStatusCode().value()).isEqualTo(404);
        assertThat(call("POST", "/v1/friends/requests", Map.of("toUserId", alice.userId.toString(), "epochId", epoch(mallory).toString(),
                "payload", Ids.random(160)), mallory.accessToken).getStatusCode().value()).isEqualTo(404);
        // Alice can't accidentally re-add Mallory either until she unblocks.
        assertThat(call("POST", "/v1/friends/requests", Map.of("toUserId", mallory.userId.toString(), "epochId", epoch(alice).toString(),
                "payload", Ids.random(160)), alice.accessToken).getStatusCode().value()).isEqualTo(404);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> blocks = http().get().uri("/v1/blocks").header("Authorization", "Bearer " + alice.accessToken).retrieve().body(List.class);
        assertThat(blocks).extracting(b -> b.get("userId")).containsExactly(mallory.userId.toString());
        assertThat(call("DELETE", "/v1/blocks/" + mallory.userId, null, alice.accessToken).getStatusCode().value()).isEqualTo(200);
    }

    @SuppressWarnings("unchecked")
    @Test
    void accountDeletionLeavesNoTrace() throws Exception {
        TestApp alice = new TestApp(this, "del_alice", "pw").register();
        TestApp bob = new TestApp(this, "del_bob", "pw").register();
        befriend(alice, bob);
        byte[] uid = Ids.bytes(alice.userId);

        // Alice leaves a footprint: a post with media, a like, a block.
        byte[] photo = Ids.random(3000);
        var slots = (List<Map<String, Object>>) (Object) http().post().uri("/v1/media/uploads").header("Authorization", "Bearer " + alice.accessToken)
                .contentType(MediaType.APPLICATION_JSON).body(Map.of("sizes", List.of(photo.length))).retrieve().body(List.class);
        String key = (String) slots.get(0).get("objectKey");
        httpClient.send(HttpRequest.newBuilder(URI.create((String) slots.get(0).get("putUrl"))).PUT(HttpRequest.BodyPublishers.ofByteArray(photo)).build(),
                HttpResponse.BodyHandlers.discarding());
        byte[] readToken = Ids.random(32);
        String postId = Ids.newId().toString();
        var body = new HashMap<String, Object>(Map.of("postId", postId, "epochId", epoch(alice).toString(), "keyRef", Ids.random(32),
                "headerCt", Ids.random(256), "media", List.of(Map.of("objectKey", key, "kind", "full"))));
        body.put("readTokenHash", core.readTokenHash(readToken));
        assertThat(call("POST", "/v1/posts", body, alice.accessToken).getStatusCode().value()).isEqualTo(201);
        withToken("PUT", "/v1/posts/" + postId + "/like", null, bob.accessToken, readToken);

        // Wrong confirmation is refused; the right one deletes everything.
        assertThat(call("DELETE", "/v1/account", Map.of("handle", "someone_else"), alice.accessToken).getStatusCode().value()).isEqualTo(400);
        assertThat(call("DELETE", "/v1/account", Map.of("handle", "del_alice"), alice.accessToken).getStatusCode().value()).isEqualTo(200);

        // No row anywhere still holds her user id (every BINARY(16) column of every table is checked).
        List<Map<String, Object>> cols = jdbc.queryForList(
                "SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() "
                        + "AND data_type = 'binary' AND character_maximum_length = 16 AND table_name <> 'flyway_schema_history'");
        for (Map<String, Object> col : cols) {
            Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM `" + col.get("t") + "` WHERE `" + col.get("c") + "` = ?", Integer.class, (Object) uid);
            assertThat(n).as(col.get("t") + "." + col.get("c")).isZero();
        }
        // Her media is gone from the bucket; her session no longer works; Bob's account is untouched.
        assertThat(s3.listObjectsV2(b -> b.bucket(s3Props.bucket()).prefix(key)).keyCount()).isZero();
        assertThat(call("POST", "/v1/auth/refresh", Map.of("refreshToken", alice.refreshToken), null).getStatusCode().value()).isEqualTo(401);
        assertThat(withToken("GET", "/v1/users/" + bob.userId + "/posts", null, bob.accessToken, null)).isEqualTo(200);
    }
}
