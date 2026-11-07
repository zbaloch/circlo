package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.TestPropertySource;

/**
 * With CIRCLO_LOGIN_CODE_FOR_OLD_APPS on, apps that don't ask for the code step (the ones already in the stores) get
 * it anyway, through the screen they already have: 403 email_not_verified with the address, a code by email, and
 * /v1/auth/signup/verify with that code signs them in. "Send a new code" there works too.
 */
@TestPropertySource(properties = "circlo.auth.login-code-for-old-apps=true")
class LoginCodeForOldAppsIT extends IntegrationTest {

    @Test
    void oldAppsGoThroughTheirCheckYourEmailScreen() throws InterruptedException {
        TestUser a = user("lco_ana");
        ResponseEntity<Map<String, Object>> r = a.login(a.username, a.password);
        assertThat(r.getStatusCode().value()).isEqualTo(403);
        assertThat(r.getBody()).containsEntry("error", "email_not_verified").containsEntry("email", a.email).doesNotContainKey("accessToken");

        // Their "Send a new code" button.
        assertThat(call("POST", "/v1/auth/signup/resend", Map.of("email", a.email), null).getStatusCode().value()).isEqualTo(202);
        String code = mail.lastCode(a.email);
        ResponseEntity<Map<String, Object>> done = call("POST", "/v1/auth/signup/verify", Map.of("email", a.email, "code", code), null);
        assertThat(done.getStatusCode().value()).isEqualTo(200);
        assertThat(done.getBody()).containsEntry("userId", a.userId.toString()).containsKey("accessToken");

        // A wrong password still answers 401 and sends nothing. (The "New sign-in" email from signing in above goes out in
        // the background; wait for it, so it isn't counted as sent by the wrong password.)
        for (int i = 0; i < 60 && mail.to(a.email).stream().noneMatch(m -> m.subject().startsWith("New sign-in")); i++) {
            Thread.sleep(50);
        }
        int before = mail.to(a.email).size();
        assertThat(a.login(a.username, "wrong password, nope").getStatusCode().value()).isEqualTo(401);
        assertThat(mail.to(a.email)).hasSize(before);
        // With no sign-in waiting for its code, a guessed code signs nobody in.
        assertThat(call("POST", "/v1/auth/signup/verify", Map.of("email", a.email, "code", "123456"), null).getStatusCode().value()).isEqualTo(400);
    }
}
