package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Who sees which post, the author-only audience badge, replies, likes, and the Notifications tab. */
class PostsFlowIT extends IntegrationTest {

    @Test
    void audiencesDecideWhoSeesWhat() {
        TestUser a = user("post_author");
        TestUser family = user("post_family");
        TestUser friend = user("post_friend");
        TestUser stranger = user("post_stranger");
        a.befriend(family, List.of(2), List.of());
        a.befriend(friend);

        a.post("just me", "onlyMe", List.of());
        a.post("hello everyone", "everyone", List.of());
        a.post("family only", "circles", List.of(2));

        assertThat(a.feedTexts()).containsExactly("family only", "hello everyone", "just me");
        assertThat(family.feedTexts()).containsExactly("family only", "hello everyone");
        assertThat(friend.feedTexts()).containsExactly("hello everyone");
        assertThat(stranger.feedTexts()).isEmpty();
        assertThat(stranger.get("/v1/users/" + a.userId + "/posts")).isEmpty();

        // Only the author sees the audience.
        Map<String, Object> mine = a.get("/v1/feed").get(0);
        assertThat(mine.get("audience")).isEqualTo(Map.of("kind", "circles", "circles", List.of(2)));
        Map<String, Object> theirs = family.get("/v1/feed").get(0);
        assertThat(theirs.get("audience")).isNull();
        assertThat(theirs.get("author")).asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP).containsEntry("username", "post_author");

        // "See what they can see" matches what they see.
        assertThat(a.get("/v1/me/preview/" + family.userId)).extracting(p -> p.get("text")).containsExactly("family only", "hello everyone");
        assertThat(a.get("/v1/me/preview/" + friend.userId)).extracting(p -> p.get("text")).containsExactly("hello everyone");
        assertThat(a.status("GET", "/v1/me/preview/" + stranger.userId, null)).isEqualTo(404);
    }

    @Test
    void aCirclePostKeepsTheAudienceItWasSharedWith() {
        TestUser a = user("snap_author");
        TestUser early = user("snap_early");
        TestUser late = user("snap_late");
        a.befriend(early, List.of(1), List.of());
        a.befriend(late);
        a.post("close friends then", "circles", List.of(1));
        // Moving someone into the circle later doesn't open earlier posts; new posts reach them.
        a.call("PUT", "/v1/friends/" + late.userId + "/circles", Map.of("circles", List.of(1)));
        a.post("close friends now", "circles", List.of(1));
        assertThat(late.feedTexts()).containsExactly("close friends now");
        assertThat(early.feedTexts()).containsExactly("close friends now", "close friends then");

        // Unfriending removes access to everything, even posts they could see before.
        a.call("DELETE", "/v1/friends/" + early.userId, null);
        assertThat(early.feedTexts()).isEmpty();
    }

    @Test
    void postsAreValidated() {
        TestUser a = user("post_rules");
        assertThat(a.call("POST", "/v1/posts", Map.of("text", "  ", "audience", Map.of("kind", "everyone"))).getBody())
                .containsEntry("error", "invalid_text");
        assertThat(a.call("POST", "/v1/posts", Map.of("text", "x".repeat(501), "audience", Map.of("kind", "everyone"))).getBody())
                .containsEntry("error", "invalid_text");
        assertThat(a.call("POST", "/v1/posts", Map.of("text", "hi", "audience", Map.of("kind", "circles", "circles", List.of()))).getBody())
                .containsEntry("error", "invalid_audience");
        assertThat(a.call("POST", "/v1/posts", Map.of("text", "hi", "audience", Map.of("kind", "circles", "circles", List.of(7)))).getBody())
                .containsEntry("error", "invalid_audience");
        assertThat(a.call("POST", "/v1/posts", Map.of("text", "hi", "audience", Map.of("kind", "everyone"),
                "media", List.of(Map.of("type", "image", "objectKey", "a".repeat(64), "previewKey", "b".repeat(64), "width", 10, "height", 10,
                        "durationMs", 0)))).getBody()).containsEntry("error", "unknown_media");
    }

    @Test
    void repliesAndLikesFollowThePost() {
        TestUser a = user("thread_author");
        TestUser b = user("thread_friend");
        TestUser c = user("thread_outsider");
        a.befriend(b, List.of(1), List.of());
        a.befriend(c);
        String post = a.post("close friends post", "circles", List.of(1));

        var reply = b.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", " nice one "));
        assertThat(reply.getStatusCode().value()).isEqualTo(201);
        assertThat(reply.getBody()).containsEntry("text", "nice one");
        assertThat(b.status("PUT", "/v1/posts/" + post + "/like", null)).isEqualTo(200);
        assertThat(b.status("PUT", "/v1/posts/" + post + "/like", null)).isEqualTo(200); // idempotent

        // Outside the audience, the post and its thread don't exist.
        assertThat(c.status("GET", "/v1/posts/" + post, null)).isEqualTo(404);
        assertThat(c.status("GET", "/v1/posts/" + post + "/replies", null)).isEqualTo(404);
        assertThat(c.status("PUT", "/v1/posts/" + post + "/like", null)).isEqualTo(404);
        assertThat(c.status("POST", "/v1/posts/" + post + "/replies", Map.of("text", "hi"))).isEqualTo(404);

        Map<String, Object> seen = a.call("GET", "/v1/posts/" + post, null).getBody();
        assertThat(seen).containsEntry("replyCount", 1).containsEntry("likeCount", 1).containsEntry("likedByMe", false);
        assertThat(b.call("GET", "/v1/posts/" + post, null).getBody()).containsEntry("likedByMe", true);
        assertThat(a.get("/v1/posts/" + post + "/replies")).extracting(r -> r.get("text")).containsExactly("nice one");
        assertThat(a.get("/v1/posts/" + post + "/likes")).extracting(l -> l.get("username")).containsExactly("thread_friend");

        // The post's author may delete any reply; others only their own.
        String replyId = (String) reply.getBody().get("replyId");
        assertThat(a.status("DELETE", "/v1/posts/" + post + "/replies/" + replyId, null)).isEqualTo(200);

        // Deleting the post removes it for everyone.
        assertThat(b.status("DELETE", "/v1/posts/" + post, null)).isEqualTo(404);
        assertThat(a.status("DELETE", "/v1/posts/" + post, null)).isEqualTo(200);
        assertThat(b.status("GET", "/v1/posts/" + post, null)).isEqualTo(404);
    }

    @Test
    void notificationsListRepliesAndLikesAndBackgroundChecksCountThem() {
        TestUser a = user("act_author");
        TestUser b = user("act_friend");
        a.befriend(b);
        String since = Instant.now().minusSeconds(5).toString();
        String post = a.post("tell me", "everyone", List.of());
        b.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", "told you"));
        b.call("PUT", "/v1/posts/" + post + "/like", null);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> items = (List<Map<String, Object>>) a.call("GET", "/v1/activity", null).getBody().get("items");
        assertThat(items).extracting(i -> i.get("kind")).containsExactly("like", "reply");
        assertThat(items.get(1)).containsEntry("replyText", "told you").containsEntry("postText", "tell me");

        String check = (String) a.call("POST", "/v1/devices/current/check-token", null).getBody().get("token");
        var pending = http().get().uri("/v1/activity/pending?since=" + since).header("X-Circlo-Check-Token", check)
                .retrieve().body(Map.class);
        assertThat(pending).containsEntry("replies", 1).containsEntry("likes", 1);
        assertThat(http().get().uri("/v1/activity/pending?since=" + since).header("X-Circlo-Check-Token", "bogus")
                .retrieve().onStatus(s -> true, (q, r) -> {}).toBodilessEntity().getStatusCode().value()).isEqualTo(401);

        // Blocking hides their activity.
        a.call("POST", "/v1/blocks/" + b.userId, null);
        assertThat((List<?>) a.call("GET", "/v1/activity", null).getBody().get("items")).isEmpty();
    }
}
