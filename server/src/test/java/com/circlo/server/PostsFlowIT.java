package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.circlo.server.crypto.CircloCore;
import com.circlo.server.posts.MediaSweeper;
import com.circlo.server.storage.S3Properties;
import com.circlo.server.web.Ids;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import software.amazon.awssdk.services.s3.S3Client;

/** Phase 7 server side: size-locked uploads, posts, friend-only reads and downloads, random object keys only. */
class PostsFlowIT extends IntegrationTest {

    @Autowired
    private CircloCore core;

    @Autowired
    private S3Client s3;

    @Autowired
    private S3Properties s3Props;

    @Autowired
    private MediaSweeper sweeper;

    @Autowired
    private org.springframework.jdbc.core.JdbcTemplate jdbc;

    private boolean exists(String key) {
        return s3.listObjectsV2(b -> b.bucket(s3Props.bucket()).prefix(key)).keyCount() > 0;
    }

    private final HttpClient httpClient = HttpClient.newHttpClient();

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

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> slots(TestApp a, long... sizes) {
        var res = http().post().uri("/v1/media/uploads").header("Authorization", "Bearer " + a.accessToken)
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .body(Map.of("sizes", java.util.Arrays.stream(sizes).boxed().toList())).retrieve().body(List.class);
        return (List<Map<String, Object>>) (List<?>) res;
    }

    private int put(String url, byte[] body) throws Exception {
        return httpClient.send(HttpRequest.newBuilder(URI.create(url)).PUT(HttpRequest.BodyPublishers.ofByteArray(body)).build(),
                HttpResponse.BodyHandlers.discarding()).statusCode();
    }

    private Map<String, Object> newPost(UUID epoch, List<Map<String, String>> media) {
        return Map.of("postId", Ids.newId().toString(), "epochId", epoch.toString(), "keyRef", Ids.random(32),
                "headerCt", Ids.random(512), "media", media, "readTokenHash", core.readTokenHash(Ids.random(32)));
    }

    @Test
    void uploadPostAndFriendDownloadRoundTrip() throws Exception {
        TestApp alice = new TestApp(this, "post_alice", "pw").register();
        TestApp bob = new TestApp(this, "post_bob", "pw").register();
        TestApp eve = new TestApp(this, "post_eve", "pw").register();
        UUID ae = epoch(alice);
        befriend(alice, ae, bob);

        byte[] full = Ids.random(70_000);
        byte[] thumb = Ids.random(5_000);
        var s = slots(alice, full.length, thumb.length);
        String fullKey = (String) s.get(0).get("objectKey");
        String thumbKey = (String) s.get(1).get("objectKey");
        assertThat(fullKey).matches("[0-9a-f]{64}");

        // The PUT is locked to the declared size.
        assertThat(put((String) s.get(0).get("putUrl"), Ids.random(full.length + 1))).isNotEqualTo(200);
        assertThat(put((String) s.get(0).get("putUrl"), full)).isEqualTo(200);
        // Posting before the thumbnail is uploaded fails.
        var early = call("POST", "/v1/posts", newPost(ae, List.of(Map.of("objectKey", fullKey, "kind", "full"),
                Map.of("objectKey", thumbKey, "kind", "thumb"))), alice.accessToken);
        assertThat(early.getBody()).isEqualTo(Map.of("error", "media_not_uploaded"));
        assertThat(put((String) s.get(1).get("putUrl"), thumb)).isEqualTo(200);

        Map<String, Object> post = newPost(ae, List.of(Map.of("objectKey", fullKey, "kind", "full"), Map.of("objectKey", thumbKey, "kind", "thumb")));
        assertThat(call("POST", "/v1/posts", post, alice.accessToken).getStatusCode().value()).isEqualTo(201);

        // Bob (friend) sees the post header and media list, and can download the ciphertext.
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> feed = http().get().uri("/v1/users/" + alice.userId + "/posts").header("Authorization", "Bearer " + bob.accessToken)
                .retrieve().body(List.class);
        assertThat(feed).hasSize(1);
        assertThat(feed.get(0).get("postId")).isEqualTo(post.get("postId"));
        assertThat((List<?>) feed.get(0).get("media")).hasSize(2);
        @SuppressWarnings("unchecked")
        String getUrl = (String) ((List<Map<String, Object>>) (Object) http().post().uri("/v1/media/download-urls")
                .header("Authorization", "Bearer " + bob.accessToken).contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .body(Map.of("objectKeys", List.of(fullKey))).retrieve().body(List.class)).get(0).get("getUrl");
        byte[] downloaded = httpClient.send(HttpRequest.newBuilder(URI.create(getUrl)).build(), HttpResponse.BodyHandlers.ofByteArray()).body();
        assertThat(downloaded).isEqualTo(full);

        // A stranger sees neither posts nor media.
        assertThat(call("GET", "/v1/users/" + alice.userId + "/posts", null, eve.accessToken).getStatusCode().value()).isEqualTo(404);
        assertThat(call("POST", "/v1/media/download-urls", Map.of("objectKeys", List.of(fullKey)), eve.accessToken).getStatusCode().value())
                .isEqualTo(404);

        // An object can't be attached twice, or by someone else.
        assertThat(call("POST", "/v1/posts", newPost(ae, List.of(Map.of("objectKey", fullKey, "kind", "full"))), alice.accessToken).getBody())
                .isEqualTo(Map.of("error", "unknown_media"));
        assertThat(call("POST", "/v1/posts", newPost(epoch(bob), List.of(Map.of("objectKey", thumbKey, "kind", "thumb"))), bob.accessToken)
                .getBody()).isEqualTo(Map.of("error", "unknown_media"));

        // Authors delete their own posts only.
        assertThat(call("DELETE", "/v1/posts/" + post.get("postId"), null, bob.accessToken).getStatusCode().value()).isEqualTo(404);
        assertThat(call("DELETE", "/v1/posts/" + post.get("postId"), null, alice.accessToken).getStatusCode().value()).isEqualTo(200);

        // A deleted post's ciphertext leaves the bucket on the next sweep, and its download URLs stop working.
        assertThat(exists(fullKey)).isTrue();
        sweeper.sweep();
        assertThat(exists(fullKey)).isFalse();
        assertThat(exists(thumbKey)).isFalse();
        assertThat(call("POST", "/v1/media/download-urls", Map.of("objectKeys", List.of(fullKey)), bob.accessToken).getStatusCode().value())
                .isEqualTo(404);
    }

    @Test
    void abandonedUploadsAreSweptAndCanNoLongerBeAttached() throws Exception {
        TestApp a = new TestApp(this, "post_dora", "pw").register();
        UUID e = epoch(a);
        byte[] body = Ids.random(1000);
        var s = slots(a, body.length, body.length);
        String fresh = (String) s.get(0).get("objectKey");
        String stale = (String) s.get(1).get("objectKey");
        assertThat(put((String) s.get(0).get("putUrl"), body)).isEqualTo(200);
        assertThat(put((String) s.get(1).get("putUrl"), body)).isEqualTo(200);
        jdbc.update("UPDATE media_uploads SET created_at = ? WHERE object_key = ?",
                java.sql.Timestamp.from(java.time.Instant.now().minus(java.time.Duration.ofHours(25))), stale);

        // Too old to attach (the sweeper may be about to delete it).
        assertThat(call("POST", "/v1/posts", newPost(e, List.of(Map.of("objectKey", stale, "kind", "full"))), a.accessToken).getBody())
                .isEqualTo(Map.of("error", "unknown_media"));
        sweeper.sweep();
        assertThat(exists(stale)).isFalse();
        assertThat(exists(fresh)).isTrue(); // still inside its window
        assertThat(call("POST", "/v1/posts", newPost(e, List.of(Map.of("objectKey", fresh, "kind", "full"))), a.accessToken)
                .getStatusCode().value()).isEqualTo(201);
    }

    @Test
    void bucketHoldsOnlyRandomObjectKeys() {
        var keys = s3.listObjectsV2(b -> b.bucket(s3Props.bucket())).contents();
        assertThat(keys).allSatisfy(o -> assertThat(o.key()).matches("[0-9a-f]{64}"));
    }

    @Test
    void textOnlyPostsAndValidation() {
        TestApp a = new TestApp(this, "post_carl", "pw").register();
        UUID e = epoch(a);
        assertThat(call("POST", "/v1/posts", newPost(e, List.of()), a.accessToken).getStatusCode().value()).isEqualTo(201);
        assertThat(call("POST", "/v1/posts", newPost(Ids.newId(), List.of()), a.accessToken).getBody()).isEqualTo(Map.of("error", "unknown_epoch"));
        assertThat(call("POST", "/v1/media/uploads", Map.of("sizes", List.of(600L * 1024 * 1024)), a.accessToken).getStatusCode().value())
                .isEqualTo(400);
    }
}
