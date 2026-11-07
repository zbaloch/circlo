package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Replying to a reply (owner request 2026-11-07). The answer stays in the circle of the reply it answers, however deep
 * the conversation goes: when the post's author answers someone from Family, Close Friends don't see it. "Replying to
 * @someone" names the reply's writer only for people who can see that reply.
 */
class ReplyThreadsIT extends IntegrationTest {

    private static final int FAMILY = 1;
    private static final int CLOSE_FRIENDS = 2;

    private static List<Object> texts(List<Map<String, Object>> replies) {
        return replies.stream().map(r -> r.get("text")).toList();
    }

    private static String reply(TestUser u, String post, String text, String parent) {
        Map<String, Object> body = new HashMap<>(Map.of("text", text));
        if (parent != null) {
            body.put("parentId", parent);
        }
        var res = u.call("POST", "/v1/posts/" + post + "/replies", body);
        assertThat(res.getStatusCode().value()).isEqualTo(201);
        return (String) res.getBody().get("replyId");
    }

    private static Map<String, Object> find(TestUser u, String post, String text) {
        return u.get("/v1/posts/" + post + "/replies").stream().filter(r -> text.equals(r.get("text"))).findFirst().orElseThrow();
    }

    @Test
    @SuppressWarnings("unchecked")
    void answersStayInTheCircleOfTheReplyTheyAnswer() {
        TestUser me = user("rt_author");
        TestUser ana = user("rt_family");
        TestUser cousin = user("rt_family2");
        TestUser ben = user("rt_friend");
        me.befriend(ana, List.of(FAMILY), List.of());
        me.befriend(cousin, List.of(FAMILY), List.of());
        me.befriend(ben, List.of(CLOSE_FRIENDS), List.of());
        String post = me.post("family and close friends", "circles", List.of(FAMILY, CLOSE_FRIENDS));

        String fromAna = reply(ana, post, "from family", null);
        String answer = reply(me, post, "author answers family", fromAna);
        reply(me, post, "author to everyone", null);
        reply(ana, post, "family again", answer);

        // Close Friends see only the author's top-level reply: the answer to Ana stays in Family.
        assertThat(texts(ben.get("/v1/posts/" + post + "/replies"))).containsExactly("author to everyone");
        assertThat(texts(cousin.get("/v1/posts/" + post + "/replies")))
                .containsExactly("from family", "author answers family", "author to everyone", "family again");
        assertThat(texts(me.get("/v1/posts/" + post + "/replies")))
                .containsExactly("from family", "author answers family", "author to everyone", "family again");
        assertThat((Integer) ben.call("GET", "/v1/posts/" + post, null).getBody().get("replyCount")).isEqualTo(1);

        // "Replying to @rt_family", and which reply it answers.
        Map<String, Object> seen = find(cousin, post, "author answers family");
        assertThat(seen).containsEntry("parentId", fromAna);
        assertThat((Map<String, Object>) seen.get("replyingTo")).containsEntry("username", "rt_family");
        assertThat(find(cousin, post, "from family").get("parentId")).isNull();
        assertThat(find(cousin, post, "family again")).containsEntry("parentId", answer);

        // Ben can't answer a reply he can't see, nor one from another post.
        assertThat(ben.status("POST", "/v1/posts/" + post + "/replies", Map.of("text", "sneaky", "parentId", fromAna))).isEqualTo(404);
        String other = me.post("another", "everyone", List.of());
        assertThat(ana.status("POST", "/v1/posts/" + other + "/replies", Map.of("text", "wrong post", "parentId", fromAna))).isEqualTo(404);

        // Ana hears that the author answered her (on her activity, for apps that ask for it).
        List<Map<String, Object>> items = (List<Map<String, Object>>) ana.call("GET", "/v1/activity?replies=all", null).getBody().get("items");
        assertThat(items).anySatisfy(i -> assertThat(i).containsEntry("kind", "reply_reply").containsEntry("replyText", "author answers family")
                .containsEntry("replyId", answer));
        List<Map<String, Object>> older = (List<Map<String, Object>>) ana.call("GET", "/v1/activity", null).getBody().get("items");
        assertThat(older).noneSatisfy(i -> assertThat(i).containsEntry("kind", "reply_reply"));

        // Deleting the reply that started it keeps the answers, still only in Family; "Replying to" goes.
        assertThat(ana.status("DELETE", "/v1/posts/" + post + "/replies/" + fromAna, null)).isEqualTo(200);
        assertThat(texts(ben.get("/v1/posts/" + post + "/replies"))).containsExactly("author to everyone");
        assertThat(texts(cousin.get("/v1/posts/" + post + "/replies"))).containsExactly("author answers family", "author to everyone", "family again");
        assertThat(find(cousin, post, "author answers family").get("replyingTo")).isNull();
    }
}
