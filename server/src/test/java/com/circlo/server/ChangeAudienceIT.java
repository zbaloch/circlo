package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The author can change who sees a post after posting (owner decision 2026-11-06). It takes effect at once: added
 * circles see it with their replies, removed ones lose it, and nobody else can change it or learn it changed.
 */
class ChangeAudienceIT extends IntegrationTest {

    private static final int FAMILY = 1;
    private static final int CLOSE_FRIENDS = 2;

    private static Map<String, Object> audience(String kind, List<Integer> circles) {
        return Map.of("kind", kind, "circles", circles);
    }

    @Test
    void theAuthorChangesWhoSeesAPost() {
        TestUser me = user("ca_author");
        TestUser maira = user("ca_family");
        TestUser imran = user("ca_friend");
        TestUser other = user("ca_other");
        me.befriend(maira, List.of(FAMILY), List.of());
        me.befriend(imran, List.of(CLOSE_FRIENDS), List.of());
        me.befriend(other);
        String post = me.post("columbus cafe", "circles", List.of(FAMILY));
        maira.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", "I remember!"));
        assertThat(imran.status("GET", "/v1/posts/" + post, null)).isEqualTo(404);

        // Add Close Friends: Imran sees it now; the badge (mine only) says so.
        var changed = me.call("PUT", "/v1/posts/" + post + "/audience", audience("circles", List.of(CLOSE_FRIENDS, FAMILY)));
        assertThat(changed.getStatusCode().value()).isEqualTo(200);
        assertThat(changed.getBody().get("audience")).isEqualTo(Map.of("kind", "circles", "circles", List.of(FAMILY, CLOSE_FRIENDS)));
        assertThat(imran.status("GET", "/v1/posts/" + post, null)).isEqualTo(200);
        assertThat(imran.call("GET", "/v1/posts/" + post, null).getBody().get("audience")).isNull();
        assertThat(imran.feedTexts()).contains("columbus cafe");

        // Only Close Friends: Maira loses it; her reply stays, seen only by her and me.
        me.call("PUT", "/v1/posts/" + post + "/audience", audience("circles", List.of(CLOSE_FRIENDS)));
        assertThat(maira.status("GET", "/v1/posts/" + post, null)).isEqualTo(404);
        assertThat(maira.feedTexts()).doesNotContain("columbus cafe");
        assertThat(imran.get("/v1/posts/" + post + "/replies")).isEmpty();
        assertThat(me.get("/v1/posts/" + post + "/replies")).hasSize(1);

        // Everyone, then Only me.
        me.call("PUT", "/v1/posts/" + post + "/audience", audience("everyone", List.of()));
        assertThat(other.status("GET", "/v1/posts/" + post, null)).isEqualTo(200);
        assertThat(me.call("GET", "/v1/posts/" + post, null).getBody().get("audience")).isEqualTo(Map.of("kind", "everyone", "circles", List.of()));
        me.call("PUT", "/v1/posts/" + post + "/audience", audience("onlyMe", List.of()));
        assertThat(other.status("GET", "/v1/posts/" + post, null)).isEqualTo(404);
        assertThat(imran.status("GET", "/v1/posts/" + post, null)).isEqualTo(404);
        assertThat(me.status("GET", "/v1/posts/" + post, null)).isEqualTo(200);
    }

    @Test
    void onlyTheAuthorCanChangeItAndOnlyToTheirOwnCircles() {
        TestUser me = user("cb_author");
        TestUser friend = user("cb_friend");
        me.befriend(friend);
        String post = me.post("hello", "everyone", List.of());

        // A reader can't change it; to them it's as if the endpoint weren't there.
        assertThat(friend.status("PUT", "/v1/posts/" + post + "/audience", audience("onlyMe", List.of()))).isEqualTo(404);
        assertThat(friend.status("GET", "/v1/posts/" + post, null)).isEqualTo(200);

        assertThat(me.call("PUT", "/v1/posts/" + post + "/audience", audience("circles", List.of())).getBody())
                .containsEntry("error", "invalid_audience");
        assertThat(me.call("PUT", "/v1/posts/" + post + "/audience", audience("circles", List.of(7))).getBody())
                .containsEntry("error", "invalid_audience");
        assertThat(me.status("PUT", "/v1/posts/" + post + "/audience", audience("nobody", List.of()))).isEqualTo(400);
        assertThat(me.status("PUT", "/v1/posts/00000000-0000-7000-8000-000000000000/audience", audience("onlyMe", List.of()))).isEqualTo(404);
        assertThat(friend.status("GET", "/v1/posts/" + post, null)).isEqualTo(200); // unchanged
    }
}
