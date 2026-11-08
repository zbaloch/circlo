package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * How much storage my account uses (owner request 2026-11-08): the photos and videos I've posted or sent, and my
 * profile photo. Files not attached to anything, files of deleted posts and other people's files don't count.
 */
class StorageUsageIT extends IntegrationTest {

    private final HttpClient client = HttpClient.newHttpClient();

    private String upload(TestUser u, int size, String mime) throws Exception {
        var slots = u.list("POST", "/v1/media/uploads", Map.of("files", List.of(Map.of("size", size, "mime", mime))));
        assertThat(slots.getStatusCode().value()).isEqualTo(200);
        Map<String, Object> slot = slots.getBody().get(0);
        var put = client.send(HttpRequest.newBuilder(URI.create((String) slot.get("putUrl"))).header("Content-Type", mime)
                .PUT(HttpRequest.BodyPublishers.ofByteArray(new byte[size])).build(), HttpResponse.BodyHandlers.discarding());
        assertThat(put.statusCode()).isEqualTo(200);
        return (String) slot.get("objectKey");
    }

    private String post(TestUser u, Map<String, Object> media) {
        var created = u.call("POST", "/v1/posts", Map.of("text", "", "audience", Map.of("kind", "everyone"), "media", List.of(media)));
        assertThat(created.getStatusCode().value()).isEqualTo(201);
        return (String) created.getBody().get("postId");
    }

    private static long n(Map<String, Object> m, String key) {
        return ((Number) m.get(key)).longValue();
    }

    @Test
    void countsWhatIKeepOnCirclo() throws Exception {
        TestUser a = user("store_owner");
        TestUser b = user("store_other");

        assertThat(a.call("GET", "/v1/me/storage", null).getBody())
                .containsEntry("usedBytes", 0).containsEntry("photos", 0).containsEntry("videos", 0);

        // A photo (1000 + 100 thumbnail), a video (5000 + 200 poster) and a profile photo (300).
        post(a, Map.of("type", "image", "objectKey", upload(a, 1000, "image/jpeg"), "previewKey", upload(a, 100, "image/jpeg"),
                "width", 800, "height", 600, "durationMs", 0));
        post(a, Map.of("type", "video", "objectKey", upload(a, 5000, "video/mp4"), "previewKey", upload(a, 200, "image/jpeg"),
                "width", 1280, "height", 720, "durationMs", 3000));
        a.call("PUT", "/v1/me/avatar", Map.of("objectKey", upload(a, 300, "image/png")));

        // Not counted: an upload never attached, a deleted post's photo, and someone else's photo.
        upload(a, 7000, "image/jpeg");
        String gone = post(a, Map.of("type", "image", "objectKey", upload(a, 9000, "image/jpeg"), "previewKey", upload(a, 90, "image/jpeg"),
                "width", 800, "height", 600, "durationMs", 0));
        assertThat(a.call("DELETE", "/v1/posts/" + gone, null).getStatusCode().is2xxSuccessful()).isTrue();
        post(b, Map.of("type", "image", "objectKey", upload(b, 4000, "image/jpeg"), "previewKey", upload(b, 40, "image/jpeg"),
                "width", 800, "height", 600, "durationMs", 0));

        Map<String, Object> s = a.call("GET", "/v1/me/storage", null).getBody();
        assertThat(n(s, "usedBytes")).isEqualTo(6600);
        assertThat(n(s, "photoBytes")).isEqualTo(1300); // photo, its thumbnail and the video's poster
        assertThat(n(s, "videoBytes")).isEqualTo(5000);
        assertThat(n(s, "profilePhotoBytes")).isEqualTo(300);
        assertThat(n(s, "photos")).isEqualTo(1);
        assertThat(n(s, "videos")).isEqualTo(1);
    }
}
