package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/**
 * What a shared invite link shows before anyone signs in (owner request 2026-11-20): the preview WhatsApp or iMessage
 * draws for www.hellocirclo.com/i/&lt;token&gt; has the inviter's name and photo. Anyone holding a current link sees just
 * that, nothing else about them; a reset or used link shows nothing.
 */
class InviteCardIT extends IntegrationTest {

    private ResponseEntity<Map<String, Object>> card(String token) {
        return call("GET", "/v1/invites/" + token + "/card", null, null);
    }

    @Test
    void aCurrentLinkShowsOnlyItsOwnersNameAndPhoto() {
        TestUser zaheer = user("ic_zaheer");
        assertThat(zaheer.call("PUT", "/v1/me/profile", Map.of("name", "Zaheer B", "bio", "Private bio")).getStatusCode().value()).isEqualTo(200);
        String token = (String) zaheer.call("GET", "/v1/invites/link", null).getBody().get("token");

        // No sign-in needed: the link's preview is drawn by the chat app, for whoever it was sent to.
        ResponseEntity<Map<String, Object>> r = card(token);
        assertThat(r.getStatusCode().value()).isEqualTo(200);
        assertThat(r.getBody()).containsOnlyKeys("name", "avatarUrl").containsEntry("name", "Zaheer B").containsEntry("avatarUrl", null);

        // A reset link shows nothing, as if it never existed; so does a made-up one.
        String fresh = (String) zaheer.call("POST", "/v1/invites/link/reset", null).getBody().get("token");
        assertThat(card(token).getStatusCode().value()).isEqualTo(404);
        assertThat(card(fresh).getStatusCode().value()).isEqualTo(200);
        assertThat(card("x".repeat(32)).getStatusCode().value()).isEqualTo(404);
        assertThat(card("bad!").getStatusCode().value()).isIn(400, 404);
    }

    @Test
    void oneTimeInvitesShowTheirOwnerUntilUsed() {
        TestUser ali = user("ic_ali");
        TestUser bilal = user("ic_bilal");
        String token = (String) ali.call("POST", "/v1/invites", null).getBody().get("token");
        // Without a name, the username stands in, as everywhere else.
        assertThat(card(token).getBody()).containsEntry("name", "ic_ali");
        assertThat(bilal.status("POST", "/v1/invites/redeem", Map.of("token", token))).isEqualTo(200);
        assertThat(card(token).getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void aDeletedAccountsLinkShowsNothing() {
        TestUser gone = user("ic_gone");
        String token = (String) gone.call("GET", "/v1/invites/link", null).getBody().get("token");
        assertThat(card(token).getStatusCode().value()).isEqualTo(200);
        assertThat(gone.call("DELETE", "/v1/account", Map.of("password", TestUser.PASSWORD)).getStatusCode().value()).isEqualTo(200);
        assertThat(card(token).getStatusCode().value()).isEqualTo(404);
    }
}
