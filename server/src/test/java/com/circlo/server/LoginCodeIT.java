package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/**
 * A second factor at login (owner decision 2026-11-07): after the right password, an emailed 6-digit code, entered on
 * the same device, finishes the sign-in. Apps ask for it with `emailCode: true`; apps already in the stores don't, and
 * keep signing in with the password alone until CIRCLO_LOGIN_CODE_FOR_OLD_APPS is turned on (LoginCodeForOldAppsIT).
 */
class LoginCodeIT extends IntegrationTest {

    private static final String SUBJECT_PREFIX = "Your Circlo sign-in code: ";

    private ResponseEntity<Map<String, Object>> start(TestUser u, String password) {
        return call("POST", "/v1/auth/login", Map.of("login", u.username, "password", password, "emailCode", true), null);
    }

    private List<TestMail.Sent> codeMails(TestUser u) {
        return mail.to(u.email).stream().filter(s -> s.subject().startsWith(SUBJECT_PREFIX)).toList();
    }

    private String lastCode(TestUser u) {
        List<TestMail.Sent> m = codeMails(u);
        return m.get(m.size() - 1).subject().substring(SUBJECT_PREFIX.length());
    }

    private ResponseEntity<Map<String, Object>> verify(TestUser u, String challenge, String code) {
        Map<String, Object> body = new HashMap<>(Map.of("login", u.username, "code", code));
        if (challenge != null) {
            body.put("challenge", challenge);
        }
        return call("POST", "/v1/auth/login/verify", body, null);
    }

    @Test
    void theRightPasswordEmailsACodeAndOnlyTheCodeSignsIn() {
        TestUser a = user("lc_ana");
        int alerts = mail.to(a.email).size();

        // A wrong password: the same 401 as ever, and no code is sent.
        assertThat(start(a, "wrong password, nope").getStatusCode().value()).isEqualTo(401);
        assertThat(codeMails(a)).isEmpty();

        ResponseEntity<Map<String, Object>> started = start(a, a.password);
        assertThat(started.getStatusCode().value()).isEqualTo(202);
        assertThat(started.getBody()).containsEntry("status", "code_sent").containsEntry("email", "l•••@example.test")
                .doesNotContainKeys("accessToken", "refreshToken");
        String challenge = (String) started.getBody().get("challenge");
        assertThat(challenge).hasSizeGreaterThan(20);
        assertThat(codeMails(a)).hasSize(1);
        assertThat(codeMails(a).get(0).body()).contains("Your code to sign in to Circlo is:", "If this wasn’t you");
        // Not signed in yet, so no "New sign-in" alert yet.
        assertThat(mail.to(a.email).stream().filter(s -> s.subject().startsWith("New sign-in"))).isEmpty();

        // The code alone, or with someone else's challenge, isn't enough; nor is a wrong code.
        String code = lastCode(a);
        assertThat(verify(a, null, code).getStatusCode().value()).isEqualTo(400);
        assertThat(verify(a, "not-the-challenge-at-all-xxxxxxxxxxxx", code).getStatusCode().value()).isEqualTo(400);
        String wrong = code.equals("000000") ? "111111" : "000000";
        assertThat(verify(a, challenge, wrong).getBody()).containsEntry("error", "invalid_code");

        ResponseEntity<Map<String, Object>> done = verify(a, challenge, code);
        assertThat(done.getStatusCode().value()).isEqualTo(200);
        assertThat(done.getBody()).containsKeys("accessToken", "refreshToken", "deviceId").containsEntry("userId", a.userId.toString());
        // Used up: the same code and challenge don't work twice.
        assertThat(verify(a, challenge, code).getStatusCode().value()).isEqualTo(400);
        // Now it's a sign-in, and the account is told.
        assertThat(mail.to(a.email).size()).isGreaterThan(alerts + 1);
    }

    @Test
    void aNewCodeCanBeSentForTheSameAttemptOnly() {
        TestUser a = user("lc_ben");
        String challenge = (String) start(a, a.password).getBody().get("challenge");
        String first = lastCode(a);

        // Asking without the challenge sends nothing (so nobody can make Circlo email someone).
        assertThat(call("POST", "/v1/auth/login/resend", Map.of("login", a.username, "challenge", "nope-nope-nope-nope-nope"), null)
                .getStatusCode().value()).isEqualTo(202);
        assertThat(codeMails(a)).hasSize(1);

        assertThat(call("POST", "/v1/auth/login/resend", Map.of("login", a.username, "challenge", challenge), null)
                .getStatusCode().value()).isEqualTo(202);
        assertThat(codeMails(a)).hasSize(2);
        String second = lastCode(a);
        if (!second.equals(first)) {
            assertThat(verify(a, challenge, first).getStatusCode().value()).isEqualTo(400); // the old code stops working
        }
        assertThat(verify(a, challenge, second).getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void fiveWrongCodesEndTheAttempt() {
        TestUser a = user("lc_cleo");
        String challenge = (String) start(a, a.password).getBody().get("challenge");
        String code = lastCode(a);
        String wrong = code.equals("000000") ? "111111" : "000000";
        for (int i = 0; i < 5; i++) {
            assertThat(verify(a, challenge, wrong).getStatusCode().value()).isEqualTo(400);
        }
        assertThat(verify(a, challenge, code).getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void appsAlreadyInTheStoresStillSignInWithTheirPassword() {
        TestUser a = user("lc_old_app");
        ResponseEntity<Map<String, Object>> r = a.login(a.username, a.password);
        assertThat(r.getStatusCode().value()).isEqualTo(200);
        assertThat(r.getBody()).containsKey("accessToken");
        assertThat(codeMails(a)).isEmpty();
    }
}
