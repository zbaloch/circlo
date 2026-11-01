package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Invites, requests, profiles and circles. */
class SocialFlowIT extends IntegrationTest {

    @Test
    void anInviteConnectsTwoPeopleAndOnlyTheOwnerSeesTheirCircles() {
        TestUser a = user("soc_ana");
        TestUser b = user("soc_ben");
        var invite = a.call("POST", "/v1/invites", null);
        assertThat(invite.getStatusCode().value()).isEqualTo(201);
        assertThat((String) invite.getBody().get("link")).startsWith("https://www.hellocirclo.com/i/");
        String token = (String) invite.getBody().get("token");

        // Strangers can't see each other or send requests without the invite.
        assertThat(b.status("GET", "/v1/users/" + a.userId, null)).isEqualTo(404);
        assertThat(b.status("POST", "/v1/friends/requests", Map.of("toUserId", a.userId.toString(), "circles", List.of()))).isEqualTo(403);

        var inviter = b.call("POST", "/v1/invites/redeem", Map.of("token", token));
        assertThat(inviter.getBody()).containsEntry("username", "soc_ana").doesNotContainKey("email");
        assertThat(b.status("POST", "/v1/invites/redeem", Map.of("token", token))).isEqualTo(404); // single use
        assertThat(b.status("POST", "/v1/friends/requests", Map.of("toUserId", a.userId.toString(), "circles", List.of(2, 3)))).isEqualTo(201);

        // Pending requests: both can see the other's profile, so Ana can see who's asking.
        assertThat(a.call("GET", "/v1/users/" + b.userId, null).getBody()).containsEntry("relation", "incoming").containsEntry("name", b.username);
        assertThat(a.status("POST", "/v1/friends/" + b.userId + "/accept", Map.of("circles", List.of(1)))).isEqualTo(200);

        Map<String, Object> benSeenByAna = a.get("/v1/friends").get(0);
        assertThat(benSeenByAna).containsEntry("status", "accepted").containsEntry("username", "soc_ben").containsEntry("circles", List.of(1));
        assertThat(b.get("/v1/friends").get(0)).containsEntry("circles", List.of(2, 3));
        assertThat(a.get("/v1/circles").get(0)).containsEntry("members", List.of(b.userId.toString()));
        assertThat(a.call("GET", "/v1/users/" + b.userId, null).getBody()).containsEntry("friendCount", 1).doesNotContainKey("email");
    }

    @Test
    void ownInvitesExpiredOnesAndDeclines() {
        TestUser a = user("soc_own");
        TestUser b = user("soc_decliner");
        String token = (String) a.call("POST", "/v1/invites", null).getBody().get("token");
        assertThat(a.call("POST", "/v1/invites/redeem", Map.of("token", token)).getBody()).containsEntry("error", "own_invite");
        assertThat(b.status("POST", "/v1/invites/redeem", Map.of("token", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"))).isEqualTo(404);

        assertThat(b.status("POST", "/v1/invites/redeem", Map.of("token", token))).isEqualTo(200);
        b.call("POST", "/v1/friends/requests", Map.of("toUserId", a.userId.toString(), "circles", List.of(1)));
        assertThat(a.status("POST", "/v1/friends/" + b.userId + "/decline", null)).isEqualTo(200);
        assertThat(a.get("/v1/friends")).isEmpty();
        assertThat(b.get("/v1/friends")).isEmpty();
        assertThat(b.get("/v1/circles").get(0)).containsEntry("members", List.of());
    }

    @Test
    void circlesCanBeAddedRenamedDeletedAndFilled() {
        TestUser a = user("soc_circles");
        TestUser b = user("soc_member");
        a.befriend(b);
        var created = a.call("POST", "/v1/circles", Map.of("name", "  Neighbours "));
        assertThat(created.getBody()).containsEntry("id", 5).containsEntry("name", "Neighbours");
        assertThat(a.status("PUT", "/v1/circles/5", Map.of("name", "Street"))).isEqualTo(200);
        assertThat(a.call("PUT", "/v1/friends/" + b.userId + "/circles", Map.of("circles", List.of(5, 2, 99))).getBody())
                .containsEntry("circles", List.of(2, 5));
        assertThat(a.get("/v1/friends").get(0)).containsEntry("circles", List.of(2, 5));
        assertThat(a.status("DELETE", "/v1/circles/5", null)).isEqualTo(200);
        assertThat(a.get("/v1/friends").get(0)).containsEntry("circles", List.of(2));
        for (int i = 0; i < 4; i++) {
            a.call("POST", "/v1/circles", Map.of("name", "Extra " + i));
        }
        assertThat(a.call("POST", "/v1/circles", Map.of("name", "One too many")).getBody()).containsEntry("error", "too_many_circles");
        // Someone else's circles can't be changed, and a stranger can't be put in mine.
        TestUser stranger = user("soc_stranger");
        assertThat(a.status("PUT", "/v1/friends/" + stranger.userId + "/circles", Map.of("circles", List.of(1)))).isEqualTo(404);
    }

    @Test
    void unfriendingAndBlockingEndTheConnection() {
        TestUser a = user("soc_unfriend");
        TestUser b = user("soc_blocked");
        a.befriend(b, List.of(1), List.of());
        assertThat(a.status("DELETE", "/v1/friends/" + b.userId, null)).isEqualTo(200);
        assertThat(a.get("/v1/circles").get(0)).containsEntry("members", List.of());
        assertThat(b.status("GET", "/v1/users/" + a.userId, null)).isEqualTo(404);

        a.befriend(b);
        assertThat(b.status("POST", "/v1/blocks/" + a.userId, null)).isEqualTo(200);
        assertThat(a.get("/v1/friends")).isEmpty();
        assertThat(b.get("/v1/blocks").get(0)).containsEntry("username", "soc_unfriend");
        String token = (String) a.call("POST", "/v1/invites", null).getBody().get("token");
        assertThat(b.status("POST", "/v1/invites/redeem", Map.of("token", token))).isEqualTo(404);
    }

    @Test
    void withoutANameOthersSeeTheUsername() {
        TestUser a = user("soc_noname_a");
        TestUser b = user("soc_noname_b");
        a.befriend(b);
        assertThat(a.get("/v1/friends").get(0)).containsEntry("name", "soc_noname_b").containsEntry("username", "soc_noname_b");
        b.call("PUT", "/v1/me/profile", Map.of("name", "Bea", "bio", ""));
        assertThat(a.get("/v1/friends").get(0)).containsEntry("name", "Bea");
        b.call("PUT", "/v1/me/profile", Map.of("name", "", "bio", ""));
        assertThat(a.call("GET", "/v1/users/" + b.userId, null).getBody()).containsEntry("name", "soc_noname_b");
        assertThat(a.status("POST", "/v1/blocks/" + b.userId, null)).isEqualTo(200);
        assertThat(a.get("/v1/blocks").get(0)).containsEntry("name", "soc_noname_b");
    }

    @Test
    void myProfileAndPhotoCanBeEdited() {
        TestUser a = user("soc_profile");
        var edited = a.call("PUT", "/v1/me/profile", Map.of("name", "Ana B.", "bio", "Hi there\nsecond line"));
        assertThat(edited.getBody()).containsEntry("name", "Ana B.").containsEntry("bio", "Hi there\nsecond line");
        assertThat(a.call("PUT", "/v1/me/profile", Map.of("name", "x".repeat(51), "bio", "")).getBody()).containsEntry("error", "invalid_name");
        // An empty name clears it.
        assertThat(a.call("PUT", "/v1/me/profile", Map.of("name", "  ", "bio", "")).getBody().get("name")).isNull();
        // An avatar must be one of my own uploads.
        assertThat(a.call("PUT", "/v1/me/avatar", Map.of("objectKey", "0".repeat(64))).getBody()).containsEntry("error", "unknown_media");
    }
}
