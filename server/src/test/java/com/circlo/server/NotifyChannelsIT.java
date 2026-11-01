package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.circlo.server.auth.TokenService;
import com.circlo.server.notify.EmailDigests;
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
 * One channel per person for replies, messages and requests: push when they're signed in to the phone app, email when
 * they aren't (web only, or nowhere), never both. Emails gather what happens in a short while into one.
 */
class NotifyChannelsIT extends IntegrationTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private EmailDigests digests;

    @Autowired
    private TokenService tokens;

    /** Sends every waiting email now; returns the notification emails this person has had so far. */
    private List<TestMail.Sent> emailsTo(TestUser u) {
        digests.sendDue(Instant.now().plus(Duration.ofHours(1)));
        return mail.to(u.email).stream().filter(s -> s.subject().startsWith("New on Circlo")).toList();
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
    void withoutTheAppActivityComesByOneGatheredEmail() {
        TestUser a = user("ch_web");
        TestUser b = user("ch_web_friend");
        assertThat(a.status("PUT", "/v1/devices/current", Map.of("kind", "web"))).isEqualTo(200);
        assertThat(a.status("PUT", "/v1/devices/current", Map.of("kind", "toaster"))).isEqualTo(400);
        a.befriend(b);
        String post = a.post("what do you think", "everyone", List.of());
        int before = emailsTo(a).size(); // the friend request's email

        reply(b, post, "secret words");
        reply(b, post, "more secret words");
        List<TestMail.Sent> after = emailsTo(a);
        assertThat(after).hasSize(before + 1);
        TestMail.Sent email = after.get(after.size() - 1);
        assertThat(email.subject()).isEqualTo("New on Circlo: 2 new replies");
        assertThat(email.body()).contains("You have 2 new replies on Circlo.", "/notifications", "/v1/email/unsubscribe?u=" + a.userId);
        // Nothing in it names anyone or quotes anything.
        assertThat(email.toString()).doesNotContain("secret words", "ch_web_friend", "what do you think");
        assertThat(email.headers()).containsEntry("List-Unsubscribe-Post", "List-Unsubscribe=One-Click");
        assertThat(email.headers().get("List-Unsubscribe")).startsWith("<https://").contains("/v1/email/unsubscribe?u=");
        assertThat(emailsTo(a)).hasSize(before + 1); // sent once
    }

    @Test
    void withTheAppOnAPhonePushOnlyEvenWithTheWebSignedIn() throws Exception {
        TestUser a = user("ch_app");
        TestUser b = user("ch_app_friend");
        a.befriend(b);
        String phone = phone(a, "ios", "ch-tok", "apns");
        String post = a.post("hello", "everyone", List.of());
        int emails = emailsTo(a).size();

        reply(b, post, "one");
        assertThat(push.await("ch-tok", 1)).hasSize(1);
        assertThat(emailsTo(a)).hasSize(emails);

        // Notifications turned off on the phone: still the app's choice, so no email either.
        assertThat(call("DELETE", "/v1/devices/current/push-token", null, phone).getStatusCode().value()).isEqualTo(200);
        reply(b, post, "two");
        Thread.sleep(300);
        assertThat(push.to("ch-tok")).hasSize(1);
        assertThat(emailsTo(a)).hasSize(emails);

        // Signed out of the app: only the web is left, so email again.
        assertThat(call("POST", "/v1/auth/logout", null, phone).getStatusCode().value()).isEqualTo(200);
        reply(b, post, "three");
        Thread.sleep(300);
        List<TestMail.Sent> all = emailsTo(a);
        assertThat(all).hasSize(emails + 1);
        assertThat(all.get(all.size() - 1).subject()).isEqualTo("New on Circlo: a new reply");
    }

    @Test
    void aDeletedAppFallsBackToEmailUntilItRegistersAgain() throws Exception {
        TestUser a = user("ch_gone");
        TestUser b = user("ch_gone_friend");
        a.befriend(b);
        String phone = phone(a, "android", "bad-gone", "fcm");
        String post = a.post("hello", "everyone", List.of());
        int emails = emailsTo(a).size();

        // Google says the token is dead: this one comes by email, and the phone stops counting as an app.
        reply(b, post, "one");
        assertThat(push.await("bad-gone", 1)).hasSize(1);
        Thread.sleep(300);
        assertThat(emailsTo(a)).hasSize(emails + 1);
        assertThat(jdbc.queryForObject("SELECT push_lost FROM devices WHERE user_id = ? AND kind = 'android'", Boolean.class,
                (Object) Ids.bytes(a.userId))).isTrue();
        reply(b, post, "two");
        Thread.sleep(300);
        assertThat(push.to("bad-gone")).hasSize(1);
        assertThat(emailsTo(a)).hasSize(emails + 2);

        // The app opened again with a fresh token: back to push.
        call("PUT", "/v1/devices/current/push-token", Map.of("token", "ch-gone-new", "service", "fcm"), phone);
        reply(b, post, "three");
        assertThat(push.await("ch-gone-new", 1)).hasSize(1);
        assertThat(emailsTo(a)).hasSize(emails + 2);
    }

    @Test
    void emailsCanBeTurnedOffInSettingsOrByTheirLink() throws Exception {
        TestUser a = user("ch_unsub");
        TestUser b = user("ch_unsub_friend");
        a.befriend(b);
        List<TestMail.Sent> first = emailsTo(a);
        assertThat(first).hasSize(1);
        assertThat(first.get(0).subject()).isEqualTo("New on Circlo: a friend request");
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
        Thread.sleep(300);
        assertThat(emailsTo(a)).hasSize(1);

        // Back on in Settings.
        assertThat(a.call("PUT", "/v1/me/notifications", Map.of("email", true)).getBody()).containsEntry("emailNotifications", true);
        reply(b, post, "two");
        Thread.sleep(300);
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
