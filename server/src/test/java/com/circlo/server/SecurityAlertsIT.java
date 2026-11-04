package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Account events are emailed and pushed straight away, whatever the notification settings (owner decisions 2026-11-01
 * and 2026-11-04): a new sign-in, a password changed or reset, and another device signed out from the Devices list
 * (signing myself out sends nothing). They say what happened and to which kind of device (iPhone, Android, browser),
 * never where from. The device that did it isn't pushed.
 */
class SecurityAlertsIT extends IntegrationTest {

    /** Waits up to 3 s for an email to this person with this subject (they're sent after the change commits). */
    private List<TestMail.Sent> await(TestUser u, String subject, int n) throws InterruptedException {
        for (int i = 0; i < 60 && withSubject(u, subject).size() < n; i++) {
            Thread.sleep(50);
        }
        return withSubject(u, subject);
    }

    private List<TestMail.Sent> withSubject(TestUser u, String subject) {
        return mail.to(u.email).stream().filter(s -> s.subject().equals(subject)).toList();
    }

    @Test
    void aNewSignInIsEmailedAtOnceEvenWithEmailsOff() throws Exception {
        TestUser a = user("sec_signin");
        assertThat(withSubject(a, "New sign-in to your Circlo account")).isEmpty(); // signing up isn't one
        assertThat(a.status("PUT", "/v1/me/notifications", Map.of("email", false))).isEqualTo(200);
        a.loginAgain();
        List<TestMail.Sent> sent = await(a, "New sign-in to your Circlo account", 1);
        assertThat(sent).hasSize(1);
        assertThat(sent.get(0).body()).contains("Someone just signed in to your Circlo account", "change your password");
        assertThat(sent.get(0).toString()).doesNotContain("127.0.0.1", "localhost", "unsubscribe");
    }

    @Test
    void passwordChangesAreEmailed() throws Exception {
        TestUser a = user("sec_pw");
        var changed = a.call("POST", "/v1/auth/password/change", Map.of("currentPassword", TestUser.PASSWORD, "newPassword", "another long password"));
        assertThat(changed.getStatusCode().value()).isEqualTo(200);
        a.take(changed.getBody());
        List<TestMail.Sent> sent = await(a, "Your Circlo password was changed", 1);
        assertThat(sent).hasSize(1);
        assertThat(sent.get(0).body()).contains("Your password was just changed", "signed out everywhere else");

        assertThat(call("POST", "/v1/auth/password/forgot", Map.of("email", a.email), null).getStatusCode().value()).isEqualTo(202);
        assertThat(call("POST", "/v1/auth/password/reset", Map.of("email", a.email, "code", mail.lastCode(a.email), "password",
                "a third long password"), null).getStatusCode().value()).isEqualTo(200);
        assertThat(await(a, "Your Circlo password was changed", 2)).hasSize(2);
    }

    @Test
    void signingOutADeviceIsEmailedNamingOnlyItsKind() throws Exception {
        TestUser a = user("sec_out");
        assertThat(a.status("PUT", "/v1/devices/current", Map.of("kind", "web"))).isEqualTo(200);
        Map<String, Object> phone = a.loginAgain();
        String access = (String) phone.get("accessToken");
        assertThat(call("PUT", "/v1/devices/current", Map.of("kind", "ios"), access).getStatusCode().value()).isEqualTo(200);

        // Signed out from the Devices list on the web: the iPhone.
        UUID phoneId = UUID.fromString((String) phone.get("deviceId"));
        assertThat(a.status("DELETE", "/v1/devices/" + phoneId, null)).isEqualTo(200);
        List<TestMail.Sent> sent = await(a, "An iPhone was signed out of your Circlo account", 1);
        assertThat(sent).hasSize(1);
        assertThat(sent.get(0).body()).contains("An iPhone was just signed out of your Circlo account");

        // Signing myself out, whether with Sign out or from the Devices list, isn't news to me: no email.
        Map<String, Object> other = a.loginAgain();
        String otherAccess = (String) other.get("accessToken");
        assertThat(call("DELETE", "/v1/devices/" + other.get("deviceId"), null, otherAccess).getStatusCode().value()).isEqualTo(200);
        assertThat(a.status("POST", "/v1/auth/logout", null)).isEqualTo(200);
        Thread.sleep(300);
        assertThat(mail.to(a.email).stream().filter(s -> s.subject().endsWith("was signed out of your Circlo account"))).hasSize(1);
    }

    /** Signs in as an iPhone with notifications on; returns its tokens. */
    private Map<String, Object> phone(TestUser u, String pushToken) {
        Map<String, Object> tokens = u.loginAgain();
        String access = (String) tokens.get("accessToken");
        assertThat(call("PUT", "/v1/devices/current", Map.of("kind", "ios"), access).getStatusCode().value()).isEqualTo(200);
        assertThat(call("PUT", "/v1/devices/current/push-token", Map.of("token", pushToken, "service", "apns"), access)
                .getStatusCode().value()).isEqualTo(200);
        return tokens;
    }

    @Test
    void securityEventsArePushedAtOnceToMyPhonesButNotTheOneThatDidIt() throws Exception {
        TestUser a = user("sec_push");
        Map<String, Object> phoneA = phone(a, "sec-tok-a");
        // A new sign-in: the phone already signed in hears about it, with no detail about the new device.
        String phoneB = (String) phone(a, "sec-tok-b").get("accessToken");
        List<TestPush.Sent> signIn = push.await("sec-tok-a", 1);
        assertThat(signIn).hasSize(1);
        assertThat(signIn.get(0).alert()).isEqualTo("New sign-in to your Circlo account. If it wasn’t you, change your password in Settings.");
        assertThat(signIn.get(0).data()).isEqualTo(Map.of("type", "security"));
        assertThat(push.to("sec-tok-b")).isEmpty(); // it was the new one

        // Phone B signs phone A out: A is told (before it loses its token), B isn't.
        assertThat(call("DELETE", "/v1/devices/" + phoneA.get("deviceId"), null, phoneB).getStatusCode().value()).isEqualTo(200);
        List<TestPush.Sent> out = push.await("sec-tok-a", 2);
        assertThat(out).hasSize(2);
        assertThat(out.get(1).alert()).startsWith("An iPhone was signed out of your Circlo account");

        // Changing the password on B: the other phones are told, B isn't.
        phone(a, "sec-tok-c");
        assertThat(push.await("sec-tok-b", 1)).hasSize(1); // C's sign-in
        var changed = call("POST", "/v1/auth/password/change", Map.of("currentPassword", TestUser.PASSWORD, "newPassword", "another long password"), phoneB);
        assertThat(changed.getStatusCode().value()).isEqualTo(200);
        List<TestPush.Sent> pw = push.await("sec-tok-c", 1);
        assertThat(pw).hasSize(1);
        assertThat(pw.get(0).alert()).isEqualTo("Your Circlo password was changed. If it wasn’t you, reset it with “Forgot password?”.");
        Thread.sleep(300);
        assertThat(push.to("sec-tok-b")).hasSize(1);
    }
}
