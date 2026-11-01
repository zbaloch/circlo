package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.circlo.server.auth.TokenService;
import com.circlo.server.web.Ids;
import java.net.URI;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Replies, messages, requests and new friends are told once a day, calmly, on one channel per person (owner decisions
 * 2026-11-01): a push when they're signed in to the phone app, an email when they aren't (web only, or nowhere), never
 * both, and only on days something happened. Neither says who, what or how many.
 */
class NotifyChannelsIT extends IntegrationTest {

    static final String CALM_PUSH = "You have a few new things waiting. Catch up when you’re ready.";

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private TokenService tokens;

    /** Runs the next day's notifications; returns the daily emails this person has had so far. */
    private List<TestMail.Sent> emailsTo(TestUser u) {
        sendDaily();
        return daily(u);
    }

    private List<TestMail.Sent> daily(TestUser u) {
        return mail.to(u.email).stream().filter(s -> s.subject().equals("Your day on Circlo")).toList();
    }

    private String phone(TestUser u, String kind, String pushToken, String service) {
        String access = (String) u.loginAgain().get("accessToken");
        assertThat(call("PUT", "/v1/devices/current", Map.of("kind", kind), access).getStatusCode().value()).isEqualTo(200);
        if (pushToken != null) {
            assertThat(call("PUT", "/v1/devices/current/push-token", Map.of("token", pushToken, "service", service), access)
                    .getStatusCode().value()).isEqualTo(200);
        }
        return access;
    }

    private String reply(TestUser from, String post, String text) {
        return (String) from.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", text)).getBody().get("replyId");
    }

    @Test
    void withoutTheAppADayComesByOneCalmEmail() {
        TestUser a = user("ch_web");
        TestUser b = user("ch_web_friend");
        assertThat(a.status("PUT", "/v1/devices/current", Map.of("kind", "web"))).isEqualTo(200);
        assertThat(a.status("PUT", "/v1/devices/current", Map.of("kind", "toaster"))).isEqualTo(400);
        a.befriend(b);
        String post = a.post("what do you think", "everyone", List.of());
        int before = emailsTo(a).size(); // the friend request's day

        reply(b, post, "secret words");
        reply(b, post, "more secret words");
        assertThat(daily(a)).hasSize(before); // nothing until the day's note
        List<TestMail.Sent> after = emailsTo(a);
        assertThat(after).hasSize(before + 1);
        TestMail.Sent email = after.get(after.size() - 1);
        assertThat(email.body()).contains("You have new replies waiting on Circlo.", "/notifications", "/v1/email/unsubscribe?u=" + a.userId);
        // Nothing in it names anyone, quotes anything or counts.
        assertThat(email.toString()).doesNotContain("secret words", "ch_web_friend", "what do you think", "2 new");
        assertThat(email.headers()).containsEntry("List-Unsubscribe-Post", "List-Unsubscribe=One-Click");
        assertThat(email.headers().get("List-Unsubscribe")).startsWith("<https://").contains("/v1/email/unsubscribe?u=");

        // A quiet day sends nothing.
        assertThat(emailsTo(a)).hasSize(before + 1);
    }

    @Test
    void itComesAtTheHourThePersonChose() {
        TestUser a = user("ch_hour");
        TestUser b = user("ch_hour_friend");
        a.befriend(b);
        emailsTo(a);
        assertThat(a.status("PUT", "/v1/me/notifications", Map.of("digestHour", 24))).isEqualTo(400);
        assertThat(a.status("PUT", "/v1/me/notifications", Map.of("digestHour", 7))).isEqualTo(200);
        String post = a.post("morning", "everyone", List.of());
        reply(b, post, "hi");
        int before = daily(a).size();
        sendDaily(18);
        assertThat(daily(a)).hasSize(before);
        sendDaily(7);
        assertThat(daily(a)).hasSize(before + 1);
    }

    @Test
    void withTheAppOnAPhoneOneCalmPushAndNoEmailEvenWithTheWebSignedIn() {
        TestUser a = user("ch_app");
        TestUser b = user("ch_app_friend");
        a.befriend(b);
        String phone = phone(a, "ios", "ch-tok", "apns");
        String post = a.post("hello", "everyone", List.of());
        sendDaily();
        int emails = daily(a).size();
        int pushes = push.to("ch-tok").size();

        reply(b, post, "one");
        reply(b, post, "two");
        assertThat(push.to("ch-tok")).hasSize(pushes); // not straight away
        sendDaily();
        List<TestPush.Sent> sent = push.to("ch-tok");
        assertThat(sent).hasSize(pushes + 1);
        assertThat(sent.get(sent.size() - 1).alert()).isEqualTo(CALM_PUSH);
        assertThat(sent.get(sent.size() - 1).data()).isEqualTo(Map.of("type", "digest"));
        assertThat(daily(a)).hasSize(emails);

        // Notifications turned off on the phone: still the app's choice, so no email either.
        assertThat(call("DELETE", "/v1/devices/current/push-token", null, phone).getStatusCode().value()).isEqualTo(200);
        reply(b, post, "three");
        sendDaily();
        assertThat(push.to("ch-tok")).hasSize(pushes + 1);
        assertThat(daily(a)).hasSize(emails);

        // Signed out of the app: only the web is left, so email again.
        assertThat(call("POST", "/v1/auth/logout", null, phone).getStatusCode().value()).isEqualTo(200);
        reply(b, post, "four");
        List<TestMail.Sent> all = emailsTo(a);
        assertThat(all).hasSize(emails + 1);
        assertThat(all.get(all.size() - 1).body()).contains("You have a new reply waiting on Circlo.");
    }

    @Test
    void aDeletedAppFallsBackToEmailUntilItRegistersAgain() {
        TestUser a = user("ch_gone");
        TestUser b = user("ch_gone_friend");
        a.befriend(b);
        sendDaily();
        String phone = phone(a, "android", "bad-gone", "fcm");
        String post = a.post("hello", "everyone", List.of());
        int emails = daily(a).size();

        // Google says the token is dead: that day comes by email, and the phone stops counting as an app.
        reply(b, post, "one");
        assertThat(emailsTo(a)).hasSize(emails + 1);
        assertThat(push.to("bad-gone")).hasSize(1);
        assertThat(jdbc.queryForObject("SELECT push_lost FROM devices WHERE user_id = ? AND kind = 'android'", Boolean.class,
                (Object) Ids.bytes(a.userId))).isTrue();
        reply(b, post, "two");
        assertThat(emailsTo(a)).hasSize(emails + 2);
        assertThat(push.to("bad-gone")).hasSize(1);

        // The app opened again with a fresh token: back to push.
        call("PUT", "/v1/devices/current/push-token", Map.of("token", "ch-gone-new", "service", "fcm"), phone);
        reply(b, post, "three");
        assertThat(emailsTo(a)).hasSize(emails + 2);
        assertThat(push.to("ch-gone-new")).hasSize(1);
    }

    @Test
    void emailsCanBeTurnedOffInSettingsOrByTheirLink() {
        TestUser a = user("ch_unsub");
        TestUser b = user("ch_unsub_friend");
        a.befriend(b);
        List<TestMail.Sent> first = emailsTo(a);
        assertThat(first).hasSize(1);
        assertThat(first.get(0).body()).contains("You have a friend request waiting on Circlo.");
        assertThat(a.call("GET", "/v1/me", null).getBody()).containsEntry("emailNotifications", true);

        Matcher m = Pattern.compile("(/v1/email/unsubscribe\\?u=[0-9a-f-]+&t=[A-Za-z0-9_-]+)").matcher(first.get(0).body());
        assertThat(m.find()).isTrue();
        String link = m.group(1);

        // Opening the link only shows a button; a forged link does nothing.
        ResponseEntity<String> page = http().get().uri(URI.create("http://localhost:" + port + link)).retrieve()
                .onStatus(s -> true, (q, r) -> {}).toEntity(String.class);
        assertThat(page.getStatusCode().value()).isEqualTo(200);
        assertThat(page.getBody()).contains("<form method=\"post\"");
        assertThat(a.call("GET", "/v1/me", null).getBody()).containsEntry("emailNotifications", true);
        String forged = link.replaceAll("t=.*", "t=" + "A".repeat(24));
        assertThat(http().post().uri(URI.create("http://localhost:" + port + forged)).retrieve().onStatus(s -> true, (q, r) -> {})
                .toBodilessEntity().getStatusCode().value()).isEqualTo(404);

        // One-click (the mail app posts to the same link).
        assertThat(http().post().uri(URI.create("http://localhost:" + port + link)).retrieve().onStatus(s -> true, (q, r) -> {})
                .toBodilessEntity().getStatusCode().value()).isEqualTo(200);
        assertThat(a.call("GET", "/v1/me", null).getBody()).containsEntry("emailNotifications", false);
        String post = a.post("hello", "everyone", List.of());
        reply(b, post, "one");
        assertThat(emailsTo(a)).hasSize(1);

        // Back on in Settings.
        assertThat(a.call("PUT", "/v1/me/notifications", Map.of("email", true)).getBody()).containsEntry("emailNotifications", true);
        reply(b, post, "two");
        assertThat(emailsTo(a)).hasSize(2);
    }

    @Test
    void devicesShowTheirKindAndLapsedSessionsAreSignedOut() {
        TestUser a = user("ch_lapse");
        phone(a, "android", null, null);
        assertThat(a.get("/v1/devices")).extracting(d -> d.get("kind")).containsExactlyInAnyOrder(null, "android");

        // The phone's session ran out (its refresh token expired unused).
        jdbc.update("UPDATE refresh_tokens t JOIN devices d ON d.id = t.device_id SET t.expires_at = ?, d.created_at = ? WHERE d.kind = 'android' AND d.user_id = ?",
                Timestamp.from(Instant.now().minusSeconds(5)), Timestamp.from(Instant.now().minus(Duration.ofDays(31))), (Object) Ids.bytes(a.userId));
        assertThat(tokens.sweepLapsed()).isEqualTo(1);
        assertThat(a.get("/v1/devices")).extracting(d -> d.get("kind")).containsExactly((Object) null);
    }
}
