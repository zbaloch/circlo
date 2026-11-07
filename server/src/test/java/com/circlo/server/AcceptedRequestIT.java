package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * "Ana accepted your request" (owner request 2026-11-07): the person who asked is told, in Notifications (for apps
 * that ask for the newer kinds) and as a new friend in the daily note.
 */
class AcceptedRequestIT extends IntegrationTest {

    @Test
    @SuppressWarnings("unchecked")
    void theRequesterHearsTheirRequestWasAccepted() {
        TestUser ana = user("acc_ana");
        TestUser ben = user("acc_ben");
        String token = (String) ana.call("POST", "/v1/invites", null).getBody().get("token");
        assertThat(ben.status("POST", "/v1/invites/redeem", Map.of("token", token))).isEqualTo(200);
        assertThat(ben.status("POST", "/v1/friends/requests", Map.of("toUserId", ana.userId.toString(), "circles", List.of(1)))).isEqualTo(201);
        assertThat(ben.status("PUT", "/v1/devices/current/push-token", Map.of("token", "acc-tok-ben", "service", "apns"))).isEqualTo(200);
        sendDaily(); // the request's day, for Ana
        assertThat(push.to("acc-tok-ben")).isEmpty();

        assertThat(ana.status("POST", "/v1/friends/" + ben.userId + "/accept", Map.of("circles", List.of(2)))).isEqualTo(200);

        List<Map<String, Object>> items = (List<Map<String, Object>>) ben.call("GET", "/v1/activity?replies=all", null).getBody().get("items");
        assertThat(items).anySatisfy(i -> {
            assertThat(i).containsEntry("kind", "accepted").containsEntry("actorId", ana.userId.toString()).containsEntry("postId", null);
            assertThat((Map<String, Object>) i.get("actor")).containsEntry("username", "acc_ana");
        });
        // Older apps don't know the kind, so they don't get it.
        List<Map<String, Object>> older = (List<Map<String, Object>>) ben.call("GET", "/v1/activity", null).getBody().get("items");
        assertThat(older).noneSatisfy(i -> assertThat(i).containsEntry("kind", "accepted"));
        // Ana, who accepted, isn't told about her own action.
        List<Map<String, Object>> anas = (List<Map<String, Object>>) ana.call("GET", "/v1/activity?replies=all", null).getBody().get("items");
        assertThat(anas).noneSatisfy(i -> assertThat(i).containsEntry("kind", "accepted"));

        // Ben's daily note comes that evening.
        sendDaily();
        assertThat(push.to("acc-tok-ben")).hasSize(1);
    }
}
