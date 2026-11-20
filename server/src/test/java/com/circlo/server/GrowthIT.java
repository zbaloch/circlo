package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

/**
 * Growth totals for Circlo's admins (owner request 2026-11-20): how many people signed up, joined through an invite,
 * connected and posted each day. Only counts, never who: no names, ids or anything about one person, and nothing new
 * is recorded to make them (they're counted from rows that already exist). Admins are listed by email in
 * CIRCLO_ADMIN_EMAILS; to anyone else the page doesn't exist.
 */
@TestPropertySource(properties = "circlo.admin-emails= GR_Admin@example.test , other@example.test")
class GrowthIT extends IntegrationTest {

    @Test
    @SuppressWarnings("unchecked")
    void adminsSeeDailyTotalsAndNothingAboutAnyone() {
        TestUser admin = user("gr_admin");
        TestUser imran = user("gr_imran");
        TestUser zulfi = user("gr_zulfi");
        TestUser joiner = user("gr_joiner");

        // Through a one-time invite and request (counts as a connection, not a link join) and through a link.
        admin.befriend(imran);
        String link = (String) admin.call("GET", "/v1/invites/link", null).getBody().get("token");
        assertThat(joiner.status("POST", "/v1/invites/join", Map.of("token", link))).isIn(200, 201);
        // A request still waiting isn't a connection.
        String once = (String) zulfi.call("POST", "/v1/invites", null).getBody().get("token");
        assertThat(imran.status("POST", "/v1/invites/redeem", Map.of("token", once))).isEqualTo(200);
        assertThat(imran.status("POST", "/v1/friends/requests", Map.of("toUserId", zulfi.userId.toString()))).isEqualTo(201);
        imran.post("hello", "everyone", List.of());
        imran.post("again", "everyone", List.of());
        admin.post("hi", "everyone", List.of());

        assertThat(admin.call("GET", "/v1/me", null).getBody()).containsEntry("admin", true);
        assertThat(imran.call("GET", "/v1/me", null).getBody()).containsEntry("admin", false);

        Map<String, Object> growth = admin.call("GET", "/v1/admin/growth", null).getBody();
        assertThat(growth.keySet()).containsExactlyInAnyOrder("days", "totals");
        assertThat((Map<String, Object>) growth.get("totals"))
                .containsEntry("people", 4).containsEntry("connections", 2).containsEntry("posts", 3);

        List<Map<String, Object>> days = (List<Map<String, Object>>) growth.get("days");
        // The last 30 days, newest first, every day present even when nothing happened.
        assertThat(days).hasSize(30);
        assertThat(days.get(0)).containsEntry("date", LocalDate.now(ZoneOffset.UTC).toString());
        assertThat(days.get(0)).containsOnlyKeys("date", "signups", "inviteJoins", "connections", "posts", "replies")
                .containsEntry("signups", 4).containsEntry("inviteJoins", 3).containsEntry("connections", 2)
                .containsEntry("posts", 3).containsEntry("replies", 0);
        assertThat(days.get(1)).containsEntry("signups", 0).containsEntry("posts", 0);

        // Anyone else: as if there were no such page. Signed out: sign in first.
        assertThat(imran.status("GET", "/v1/admin/growth", null)).isEqualTo(404);
        assertThat(call("GET", "/v1/admin/growth", null, null).getStatusCode().value()).isEqualTo(401);
    }
}
