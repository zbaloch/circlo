package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Account events are emailed straight away, whatever the notification settings (owner decision 2026-11-01): a new
 * sign-in, a password changed or reset, and another device signed out from the Devices list (signing myself out sends
 * nothing). They say what happened and to which kind of device
 * (iPhone, Android, browser), never where from.
 */
class SecurityEmailsIT extends IntegrationTest {

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
}
