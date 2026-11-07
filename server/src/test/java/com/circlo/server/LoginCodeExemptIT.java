package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.TestPropertySource;

/**
 * App review accounts (CIRCLO_LOGIN_CODE_EXEMPT, owner decision 2026-11-08): Apple's and Google's reviewers sign in
 * with the username and password alone, since they can't read the account's email. Everyone else still gets the code,
 * from new apps and (with CIRCLO_LOGIN_CODE_FOR_OLD_APPS) old ones.
 */
@TestPropertySource(properties = {"circlo.auth.login-code-exempt=LCE_Review, lce_review2", "circlo.auth.login-code-for-old-apps=true"})
class LoginCodeExemptIT extends IntegrationTest {

    private ResponseEntity<Map<String, Object>> newApp(String login, String password) {
        return call("POST", "/v1/auth/login", Map.of("login", login, "password", password, "emailCode", true), null);
    }

    private long codeMails(TestUser u) {
        return mail.to(u.email).stream().filter(s -> s.subject().startsWith("Your Circlo sign-in code")).count();
    }

    @Test
    void aReviewAccountSignsInWithItsPasswordAloneFromNewAndOldApps() {
        TestUser review = user("lce_review");
        ResponseEntity<Map<String, Object>> r = newApp(review.username, review.password);
        assertThat(r.getStatusCode().value()).isEqualTo(200);
        assertThat(r.getBody()).containsKey("accessToken").doesNotContainKey("challenge");
        // Signing in with its email works the same way.
        assertThat(newApp(review.email, review.password).getStatusCode().value()).isEqualTo(200);
        // Apps already in the stores, with the code switched on for them.
        ResponseEntity<Map<String, Object>> old = review.login(review.username, review.password);
        assertThat(old.getStatusCode().value()).isEqualTo(200);
        assertThat(old.getBody()).containsKey("accessToken");
        assertThat(codeMails(review)).isZero();
    }

    @Test
    void itStillNeedsTheRightPassword() {
        TestUser review = user("lce_review2");
        assertThat(newApp(review.username, "wrong password, nope").getStatusCode().value()).isEqualTo(401);
        assertThat(review.login(review.username, "wrong password, nope").getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void everyoneElseStillGetsTheCode() {
        TestUser ana = user("lce_ana");
        ResponseEntity<Map<String, Object>> r = newApp(ana.username, ana.password);
        assertThat(r.getStatusCode().value()).isEqualTo(202);
        assertThat(r.getBody()).containsEntry("status", "code_sent").doesNotContainKey("accessToken");
        assertThat(ana.login(ana.username, ana.password).getStatusCode().value()).isEqualTo(403);
    }
}
