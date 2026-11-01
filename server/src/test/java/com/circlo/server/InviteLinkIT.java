package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.circlo.server.notify.EmailDigests;
import com.circlo.server.web.Ids;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Everyone has one invite link (and QR code) that stays the same until they reset it (owner decision 2026-11-01).
 * Opening it connects at once: the inviter sees the new friend in Notifications and they're in the inviter's Everyone
 * until the inviter chooses circles.
 */
class InviteLinkIT extends IntegrationTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private EmailDigests digests;

    private static String token(TestUser u) {
        return (String) u.call("GET", "/v1/invites/link", null).getBody().get("token");
    }

    private static int join(TestUser who, String token, List<Integer> circles) {
        return who.status("POST", "/v1/invites/join", Map.of("token", token, "circles", circles));
    }

    private static String relationTo(TestUser me, TestUser other) {
        return me.get("/v1/friends").stream().filter(f -> f.get("userId").equals(other.userId.toString()))
                .map(f -> (String) f.get("status")).findFirst().orElse(null);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> activity(TestUser u) {
        return (List<Map<String, Object>>) u.call("GET", "/v1/activity", null).getBody().get("items");
    }

    @Test
    void theLinkStaysTheSameAndWorksForManyPeople() {
        TestUser a = user("il_owner");
        TestUser b = user("il_first");
        TestUser c = user("il_second");
        Map<String, Object> link = a.call("GET", "/v1/invites/link", null).getBody();
        String t = (String) link.get("token");
        assertThat((String) link.get("link")).endsWith("/i/" + t);
        assertThat(token(a)).isEqualTo(t);

        // Looking at it says who it's from and changes nothing.
        Map<String, Object> from = b.call("POST", "/v1/invites/preview", Map.of("token", t)).getBody();
        assertThat(from).containsEntry("userId", a.userId.toString()).containsEntry("username", "il_owner");
        assertThat(relationTo(b, a)).isNull();

        // Opening it connects at once, both ways, and the joiner's circles for the owner are kept.
        a.call("POST", "/v1/circles", Map.of("name", "Family"));
        b.call("POST", "/v1/circles", Map.of("name", "Work"));
        String everyone = a.post("for everyone", "everyone", List.of());
        assertThat(join(b, t, List.of(1))).isEqualTo(200);
        assertThat(relationTo(b, a)).isEqualTo("accepted");
        assertThat(relationTo(a, b)).isEqualTo("accepted");
        assertThat(b.get("/v1/friends").get(0).get("circles")).isEqualTo(List.of(1));
        assertThat(a.get("/v1/friends").get(0).get("circles")).isEqualTo(List.of()); // Everyone, until a chooses
        assertThat(b.feedTexts()).contains("for everyone");
        assertThat(b.status("GET", "/v1/posts/" + everyone, null)).isEqualTo(200);

        // Still the same link, and it works for the next person.
        assertThat(token(a)).isEqualTo(t);
        assertThat(join(c, t, List.of())).isEqualTo(200);
        assertThat(relationTo(a, c)).isEqualTo("accepted");

        // Again: already connected.
        assertThat(join(b, t, List.of())).isEqualTo(409);
        // My own link.
        assertThat(join(a, t, List.of())).isEqualTo(400);
        // A made-up one.
        assertThat(join(b, "A".repeat(32), List.of())).isEqualTo(404);
        assertThat(b.status("POST", "/v1/invites/preview", Map.of("token", "A".repeat(32)))).isEqualTo(404);
    }

    @Test
    void theOwnerIsToldSomeoneJoined() {
        TestUser a = user("il_told");
        TestUser b = user("il_told_joiner");
        int before = mail.to(a.email).size();
        assertThat(join(b, token(a), List.of())).isEqualTo(200);

        List<Map<String, Object>> items = activity(a);
        assertThat(items).hasSize(1);
        assertThat(items.get(0)).containsEntry("kind", "joined").containsEntry("actorId", b.userId.toString()).containsEntry("postId", null);
        assertThat(activity(b)).isEmpty(); // the joiner knows already

        // No app on a phone: an email, saying nothing about who.
        digests.sendDue(Instant.now().plus(Duration.ofHours(1)));
        List<TestMail.Sent> emails = mail.to(a.email);
        assertThat(emails).hasSize(before + 1);
        assertThat(emails.get(emails.size() - 1).subject()).isEqualTo("New on Circlo: a new friend");
        assertThat(emails.get(emails.size() - 1).toString()).doesNotContain("il_told_joiner");

        // Removed: the notification goes too.
        assertThat(a.status("DELETE", "/v1/friends/" + b.userId, null)).isEqualTo(200);
        assertThat(activity(a)).isEmpty();
    }

    @Test
    void resettingStopsTheOldLinkButKeepsFriends() {
        TestUser a = user("il_reset");
        TestUser b = user("il_reset_b");
        TestUser c = user("il_reset_c");
        String old = token(a);
        assertThat(join(b, old, List.of())).isEqualTo(200);

        Map<String, Object> fresh = a.call("POST", "/v1/invites/link/reset", null).getBody();
        String t = (String) fresh.get("token");
        assertThat(t).isNotEqualTo(old);
        assertThat(token(a)).isEqualTo(t);
        assertThat(join(c, old, List.of())).isEqualTo(404);
        assertThat(relationTo(a, b)).isEqualTo("accepted");
        assertThat(join(c, t, List.of())).isEqualTo(200);
    }

    @Test
    void someoneIRemovedOrBlockedCantComeBackThroughMyLink() {
        TestUser a = user("il_gate");
        TestUser b = user("il_gate_removed");
        TestUser c = user("il_gate_blocked");
        String t = token(a);
        assertThat(join(b, t, List.of())).isEqualTo(200);
        assertThat(a.status("DELETE", "/v1/friends/" + b.userId, null)).isEqualTo(200);
        assertThat(join(b, t, List.of())).isEqualTo(404);
        assertThat(b.status("POST", "/v1/invites/preview", Map.of("token", t))).isEqualTo(404);
        // Not even after a reset: removing someone is meant to last.
        a.call("POST", "/v1/invites/link/reset", null);
        assertThat(join(b, token(a), List.of())).isEqualTo(404);
        // I can still go back to them through theirs, which lets them in again.
        assertThat(join(a, token(b), List.of())).isEqualTo(200);
        assertThat(relationTo(a, b)).isEqualTo("accepted");

        assertThat(c.status("POST", "/v1/blocks/" + a.userId, null)).isEqualTo(200);
        assertThat(join(c, token(a), List.of())).isEqualTo(404);

        // Someone who removed me can come back: my link is my standing invitation.
        TestUser d = user("il_gate_left");
        assertThat(join(d, token(a), List.of())).isEqualTo(200);
        assertThat(d.status("DELETE", "/v1/friends/" + a.userId, null)).isEqualTo(200);
        assertThat(join(d, token(a), List.of())).isEqualTo(200);
    }

    @Test
    void aPendingRequestEitherWayBecomesAConnection() {
        TestUser a = user("il_pending");
        TestUser b = user("il_pending_b");
        // b asked a through an old one-time invite of a's, and a hasn't answered yet.
        String once = (String) a.call("POST", "/v1/invites", null).getBody().get("token");
        assertThat(b.status("POST", "/v1/invites/join", Map.of("token", once, "circles", List.of()))).isEqualTo(200);
        assertThat(relationTo(a, b)).isEqualTo("incoming");
        assertThat(join(b, token(a), List.of())).isEqualTo(200);
        assertThat(relationTo(a, b)).isEqualTo("accepted");
    }

    @Test
    void oneTimeInvitesAlreadySentStillWork() {
        TestUser a = user("il_once");
        TestUser b = user("il_once_b");
        String once = (String) a.call("POST", "/v1/invites", null).getBody().get("token");
        assertThat(b.call("POST", "/v1/invites/preview", Map.of("token", once)).getBody()).containsEntry("userId", a.userId.toString());
        Map<String, Object> joined = b.call("POST", "/v1/invites/join", Map.of("token", once, "circles", List.of())).getBody();
        assertThat(joined).containsEntry("status", "outgoing"); // a request, as before
        assertThat(relationTo(a, b)).isEqualTo("incoming");
        assertThat(join(user("il_once_c"), once, List.of())).isEqualTo(404); // used
    }

    @Test
    void olderAppsUsingRedeemConnectThroughTheLinkToo() {
        TestUser a = user("il_old_app");
        TestUser b = user("il_old_app_b");
        String t = token(a);
        assertThat(b.call("POST", "/v1/invites/redeem", Map.of("token", t)).getBody()).containsEntry("userId", a.userId.toString());
        assertThat(relationTo(a, b)).isEqualTo("accepted");
        // What the old app does next: asks to connect, and is told it already is.
        assertThat(b.status("POST", "/v1/friends/requests", Map.of("toUserId", a.userId.toString(), "circles", List.of()))).isEqualTo(409);
    }

    @Test
    void aLinkThatLeaksCanOnlyLetSoManyInADay() {
        TestUser a = user("il_cap");
        String t = token(a);
        // As if a day's worth of people had just joined.
        for (int i = 0; i < 20; i++) {
            TestUser x = user("il_cap_" + i);
            jdbc.update("INSERT INTO friendships (id, user_a, user_b, status, created_at, via_link) VALUES (?, ?, ?, 'accepted', ?, TRUE)",
                    Ids.bytes(Ids.newId()), Ids.bytes(x.userId), Ids.bytes(a.userId), Timestamp.from(Instant.now()));
        }
        TestUser late = user("il_cap_late");
        assertThat(join(late, t, List.of())).isEqualTo(429);
        jdbc.update("UPDATE friendships SET created_at = ? WHERE user_b = ?", Timestamp.from(Instant.now().minus(Duration.ofDays(2))),
                (Object) Ids.bytes(a.userId));
        assertThat(join(late, t, List.of())).isEqualTo(200);
    }
}
