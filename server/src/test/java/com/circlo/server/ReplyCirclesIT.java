package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Replies stay in the circle they came from (owner decision 2026-11-06): on a post shared with several circles, a
 * reply is seen by its author, the post's author, and the people who share one of the post's circles with whoever
 * wrote it. The post's author's own replies reach everyone who can see the post. Everyone posts are one group.
 */
class ReplyCirclesIT extends IntegrationTest {

    private static final int FAMILY = 1;
    private static final int CLOSE_FRIENDS = 2;

    private static List<Object> texts(List<Map<String, Object>> replies) {
        return replies.stream().map(r -> r.get("text")).toList();
    }

    private static int replyCount(TestUser u, String post) {
        return (Integer) u.call("GET", "/v1/posts/" + post, null).getBody().get("replyCount");
    }

    @Test
    void eachCircleSeesOnlyItsOwnReplies() {
        TestUser me = user("rc_author");
        TestUser maira = user("rc_family");
        TestUser imran = user("rc_friend");
        TestUser both = user("rc_both");
        me.befriend(maira, List.of(FAMILY), List.of());
        me.befriend(imran, List.of(CLOSE_FRIENDS), List.of());
        me.befriend(both, List.of(FAMILY, CLOSE_FRIENDS), List.of());
        String post = me.post("family and close friends", "circles", List.of(FAMILY, CLOSE_FRIENDS));

        String fromMaira = (String) maira.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", "from family")).getBody().get("replyId");
        imran.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", "from close friends"));
        both.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", "from both"));
        me.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", "from the author"));

        assertThat(texts(me.get("/v1/posts/" + post + "/replies")))
                .containsExactly("from family", "from close friends", "from both", "from the author");
        assertThat(texts(maira.get("/v1/posts/" + post + "/replies"))).containsExactly("from family", "from both", "from the author");
        assertThat(texts(imran.get("/v1/posts/" + post + "/replies"))).containsExactly("from close friends", "from both", "from the author");
        assertThat(texts(both.get("/v1/posts/" + post + "/replies")))
                .containsExactly("from family", "from close friends", "from both", "from the author");

        // Counts give nothing away either, in the feed, on the post, and in "See what they can see".
        assertThat(replyCount(me, post)).isEqualTo(4);
        assertThat(replyCount(imran, post)).isEqualTo(3);
        assertThat(imran.get("/v1/feed").get(0)).containsEntry("replyCount", 3);
        assertThat(me.get("/v1/me/preview/" + imran.userId).get(0)).containsEntry("replyCount", 3);

        // A reply from another circle doesn't exist for me: I can't like it, report it, or find it on their profile.
        assertThat(imran.status("PUT", "/v1/posts/" + post + "/replies/" + fromMaira + "/like", null)).isEqualTo(404);
        assertThat(imran.status("POST", "/v1/reports", Map.of("kind", "reply", "targetId", fromMaira, "reason", "harassment"))).isEqualTo(404);
        assertThat(imran.get("/v1/users/" + maira.userId + "/replies")).isEmpty();
        assertThat(both.get("/v1/users/" + maira.userId + "/replies")).hasSize(1);
        assertThat(both.status("PUT", "/v1/posts/" + post + "/replies/" + fromMaira + "/like", null)).isEqualTo(200);

        // Circles decide it now: put Imran in Family too and he sees Family's replies; take him out and they go.
        me.call("PUT", "/v1/friends/" + imran.userId + "/circles", Map.of("circles", List.of(FAMILY, CLOSE_FRIENDS)));
        assertThat(texts(imran.get("/v1/posts/" + post + "/replies"))).contains("from family");
        me.call("PUT", "/v1/friends/" + imran.userId + "/circles", Map.of("circles", List.of(CLOSE_FRIENDS)));
        assertThat(texts(imran.get("/v1/posts/" + post + "/replies"))).doesNotContain("from family");

        // Someone taken out of every circle of the post keeps their reply, seen only by the post's author.
        me.call("PUT", "/v1/friends/" + maira.userId + "/circles", Map.of("circles", List.of()));
        assertThat(texts(both.get("/v1/posts/" + post + "/replies"))).doesNotContain("from family");
        assertThat(texts(me.get("/v1/posts/" + post + "/replies"))).contains("from family");
    }

    @Test
    void everyonePostsAreOneConversation() {
        TestUser me = user("re_author");
        TestUser maira = user("re_family");
        TestUser imran = user("re_friend");
        me.befriend(maira, List.of(FAMILY), List.of());
        me.befriend(imran);
        String post = me.post("for everyone", "everyone", List.of());
        maira.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", "from family"));
        imran.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", "from a friend"));

        assertThat(texts(imran.get("/v1/posts/" + post + "/replies"))).containsExactly("from family", "from a friend");
        assertThat(texts(maira.get("/v1/posts/" + post + "/replies"))).containsExactly("from family", "from a friend");
        assertThat(replyCount(maira, post)).isEqualTo(2);
    }
}
