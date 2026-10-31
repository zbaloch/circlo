package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Photos through presigned URLs (needs the circlo-media-test bucket): upload, attach, download, avatar. */
class MediaFlowIT extends IntegrationTest {

    private final HttpClient client = HttpClient.newHttpClient();

    /** Uploads `bytes` as `mime` through a slot; returns the object key. */
    private String upload(TestUser u, byte[] bytes, String mime) throws Exception {
        var slots = u.list("POST", "/v1/media/uploads", Map.of("files", List.of(Map.of("size", bytes.length, "mime", mime))));
        assertThat(slots.getStatusCode().value()).isEqualTo(200);
        Map<String, Object> slot = slots.getBody().get(0);
        var put = client.send(HttpRequest.newBuilder(URI.create((String) slot.get("putUrl"))).header("Content-Type", mime)
                .PUT(HttpRequest.BodyPublishers.ofByteArray(bytes)).build(), HttpResponse.BodyHandlers.discarding());
        assertThat(put.statusCode()).isEqualTo(200);
        return (String) slot.get("objectKey");
    }

    @Test
    void aPhotoPostReachesItsAudienceOnly() throws Exception {
        TestUser a = user("media_author");
        TestUser b = user("media_friend");
        TestUser c = user("media_stranger");
        a.befriend(b);
        byte[] photo = "pretend this is a jpeg".getBytes();
        String full = upload(a, photo, "image/jpeg");
        String thumb = upload(a, "small".getBytes(), "image/jpeg");

        // Someone else can't attach my uploads.
        Map<String, Object> media = Map.of("type", "image", "objectKey", full, "previewKey", thumb, "width", 800, "height", 600, "durationMs", 0);
        assertThat(c.call("POST", "/v1/posts", Map.of("text", "", "audience", Map.of("kind", "everyone"), "media", List.of(media))).getBody())
                .containsEntry("error", "unknown_media");
        var created = a.call("POST", "/v1/posts", Map.of("text", "", "audience", Map.of("kind", "everyone"), "media", List.of(media)));
        assertThat(created.getStatusCode().value()).isEqualTo(201);
        // ... and they can be attached only once.
        assertThat(a.call("POST", "/v1/posts", Map.of("text", "again", "audience", Map.of("kind", "everyone"), "media", List.of(media))).getBody())
                .containsEntry("error", "unknown_media");

        @SuppressWarnings("unchecked")
        Map<String, Object> seen = ((List<Map<String, Object>>) b.get("/v1/feed").get(0).get("media")).get(0);
        assertThat(seen).containsEntry("type", "image").containsEntry("mime", "image/jpeg").containsEntry("width", 800);
        var body = client.send(HttpRequest.newBuilder(URI.create((String) seen.get("url"))).GET().build(), HttpResponse.BodyHandlers.ofByteArray());
        assertThat(body.body()).isEqualTo(photo);
        assertThat(c.get("/v1/feed")).isEmpty();
    }

    @Test
    void myPhotoShowsOnMyProfile() throws Exception {
        TestUser a = user("media_avatar");
        String key = upload(a, "avatar bytes".getBytes(), "image/png");
        var me = a.call("PUT", "/v1/me/avatar", Map.of("objectKey", key));
        assertThat(me.getStatusCode().value()).isEqualTo(200);
        assertThat((String) me.getBody().get("avatarUrl")).contains(key);
        assertThat(a.call("DELETE", "/v1/me/avatar", null).getBody().get("avatarUrl")).isNull();
    }
}
