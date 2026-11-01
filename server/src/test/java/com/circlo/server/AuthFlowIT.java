package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/** Signup with an emailed code, login by username or email, lockout, password reset and change, sessions. */
class AuthFlowIT extends IntegrationTest {

    @Autowired
    private JdbcTemplate jdbc;

    private TestUser fresh(String username) {
        return new TestUser(this, username, username + "@example.test", TestUser.PASSWORD);
    }

    @Test
    void signupNeedsTheEmailedCodeThenLogsInByUsernameOrEmail() {
        TestUser a = fresh("ana_signup");
        assertThat(a.startSignup().getStatusCode().value()).isEqualTo(201);
        // Not an account yet: logging in sends a fresh code instead.
        ResponseEntity<Map<String, Object>> early = a.login("ana_signup", TestUser.PASSWORD);
        assertThat(early.getStatusCode().value()).isEqualTo(403);
        assertThat(early.getBody()).containsEntry("error", "email_not_verified").containsEntry("email", a.email);

        assertThat(call("POST", "/v1/auth/signup/verify", Map.of("email", a.email, "code", "000000"), null).getBody())
                .containsEntry("error", "invalid_code");
        var verified = call("POST", "/v1/auth/signup/verify", Map.of("email", a.email, "code", mail.lastCode(a.email)), null);
        assertThat(verified.getStatusCode().value()).isEqualTo(200);
        a.take(verified.getBody());

        var me = a.call("GET", "/v1/me", null).getBody();
        assertThat(me).containsEntry("username", "ana_signup").containsEntry("email", a.email);
        // Sign-up asks for no name: it stays empty until set in Edit profile.
        assertThat(me.get("name")).isNull();
        assertThat(a.get("/v1/circles")).extracting(c -> c.get("name")).containsExactly("Close Friends", "Family", "Kids", "Work");

        assertThat(a.login("ANA_signup", TestUser.PASSWORD).getStatusCode().value()).isEqualTo(200);
        assertThat(a.login("@ana_signup", TestUser.PASSWORD).getStatusCode().value()).isEqualTo(200);
        assertThat(a.login("Ana_Signup@Example.test", TestUser.PASSWORD).getStatusCode().value()).isEqualTo(200);
        // The code is single use.
        assertThat(call("POST", "/v1/auth/signup/verify", Map.of("email", a.email, "code", mail.lastCode(a.email)), null)
                .getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void passwordsAreStoredOnlyAsArgon2idHashes() {
        TestUser a = user("hash_check");
        String stored = jdbc.queryForObject("SELECT password_hash FROM users WHERE username = 'hash_check'", String.class);
        assertThat(stored).startsWith("$argon2id$").doesNotContain(a.password);
    }

    @Test
    void usernamesAndEmailsAreUniqueAndValidated() {
        user("taken_name");
        TestUser sameName = new TestUser(this, "Taken_Name", "other1@example.test", TestUser.PASSWORD);
        assertThat(sameName.startSignup().getBody()).containsEntry("error", "username_taken");
        TestUser sameEmail = new TestUser(this, "other_name", "TAKEN_NAME@example.test", TestUser.PASSWORD);
        assertThat(sameEmail.startSignup().getBody()).containsEntry("error", "email_taken");

        assertThat(new TestUser(this, "a", "a@example.test", TestUser.PASSWORD).startSignup().getBody())
                .containsEntry("error", "invalid_username");
        assertThat(new TestUser(this, "bad-chars", "b@example.test", TestUser.PASSWORD).startSignup().getBody())
                .containsEntry("error", "invalid_username");
        assertThat(new TestUser(this, "good_name", "not-an-email", TestUser.PASSWORD).startSignup().getBody())
                .containsEntry("error", "invalid_email");
        assertThat(new TestUser(this, "good_name", "d@example.test", "short").startSignup().getBody())
                .containsEntry("error", "weak_password");
    }

    @Test
    void anUnfinishedSignupDoesNotHoldTheUsername() {
        TestUser abandoned = new TestUser(this, "kim_abandon", "kim1@example.test", TestUser.PASSWORD);
        assertThat(abandoned.startSignup().getStatusCode().value()).isEqualTo(201);
        TestUser real = new TestUser(this, "kim_abandon", "kim2@example.test", TestUser.PASSWORD).signUp();
        assertThat(real.call("GET", "/v1/me", null).getBody()).containsEntry("email", "kim2@example.test");
        // The first signup's code no longer works.
        assertThat(call("POST", "/v1/auth/signup/verify", Map.of("email", abandoned.email, "code", mail.lastCode(abandoned.email)), null)
                .getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void codesStopWorkingAfterFiveWrongGuesses() {
        TestUser a = fresh("guess_limit");
        a.startSignup();
        String right = mail.lastCode(a.email);
        String wrong = right.equals("111111") ? "222222" : "111111";
        for (int i = 0; i < 5; i++) {
            assertThat(call("POST", "/v1/auth/signup/verify", Map.of("email", a.email, "code", wrong), null).getStatusCode().value()).isEqualTo(400);
        }
        assertThat(call("POST", "/v1/auth/signup/verify", Map.of("email", a.email, "code", right), null).getStatusCode().value()).isEqualTo(400);
        // A resend gives a working code.
        assertThat(call("POST", "/v1/auth/signup/resend", Map.of("email", a.email), null).getStatusCode().value()).isEqualTo(202);
        assertThat(call("POST", "/v1/auth/signup/verify", Map.of("email", a.email, "code", mail.lastCode(a.email)), null)
                .getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void threeWrongPasswordsLockLoginAndUnknownAccountsLookTheSame() {
        TestUser a = user("lock_me");
        var first = a.login("lock_me", "wrong password one");
        assertThat(first.getStatusCode().value()).isEqualTo(401);
        assertThat(first.getBody()).containsEntry("attemptsLeft", 2);
        var unknown = a.login("nobody_here", "wrong password one");
        assertThat(unknown.getStatusCode().value()).isEqualTo(401);
        assertThat(unknown.getBody()).containsOnlyKeys("error", "attemptsLeft").containsEntry("attemptsLeft", 2);

        a.login("lock_me@example.test", "wrong password two"); // the same account by email counts too
        var third = a.login("lock_me", "wrong password three");
        assertThat(third.getBody()).containsEntry("attemptsLeft", 0).containsKey("lockSeconds");
        var locked = a.login("lock_me", TestUser.PASSWORD);
        assertThat(locked.getStatusCode().value()).isEqualTo(429);
        assertThat(locked.getBody()).containsEntry("error", "locked");
        assertThat(locked.getHeaders().getFirst("Retry-After")).isNotNull();

        // Resetting the password by email lifts the lock.
        assertThat(call("POST", "/v1/auth/password/forgot", Map.of("email", a.email), null).getStatusCode().value()).isEqualTo(202);
        var reset = call("POST", "/v1/auth/password/reset", Map.of("email", a.email, "code", mail.lastCode(a.email), "password",
                "a brand new long password"), null);
        assertThat(reset.getStatusCode().value()).isEqualTo(200);
        assertThat(a.login("lock_me", "a brand new long password").getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void aSuccessfulLoginStartsTheCountAgain() {
        TestUser a = user("count_again");
        a.login("count_again", "wrong one");
        a.login("count_again", "wrong two");
        assertThat(a.login("count_again", TestUser.PASSWORD).getStatusCode().value()).isEqualTo(200);
        assertThat(a.login("count_again", "wrong three").getBody()).containsEntry("attemptsLeft", 2);
    }

    @Test
    void forgotPasswordSaysNothingAboutUnknownEmailsAndResetSignsEveryoneOut() {
        assertThat(call("POST", "/v1/auth/password/forgot", Map.of("email", "nobody@example.test"), null).getStatusCode().value()).isEqualTo(202);
        assertThat(mail.to("nobody@example.test")).isEmpty();

        TestUser a = user("reset_me");
        Map<String, Object> other = a.loginAgain();
        call("POST", "/v1/auth/password/forgot", Map.of("email", a.email), null);
        var reset = call("POST", "/v1/auth/password/reset", Map.of("email", a.email, "code", mail.lastCode(a.email), "password",
                "my new password is long"), null);
        assertThat(reset.getStatusCode().value()).isEqualTo(200);
        assertThat(call("POST", "/v1/auth/refresh", Map.of("refreshToken", a.refreshToken), null).getStatusCode().value()).isEqualTo(401);
        assertThat(call("POST", "/v1/auth/refresh", Map.of("refreshToken", other.get("refreshToken")), null).getStatusCode().value()).isEqualTo(401);
        assertThat(a.login("reset_me", TestUser.PASSWORD).getStatusCode().value()).isEqualTo(401);
        assertThat(a.login("reset_me", "my new password is long").getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void changingThePasswordKeepsThisDeviceAndSignsOutTheOthers() {
        TestUser a = user("change_pw");
        Map<String, Object> other = a.loginAgain();
        assertThat(a.call("POST", "/v1/auth/password/change", Map.of("currentPassword", "not it at all", "newPassword", "another long password"))
                .getBody()).containsEntry("error", "wrong_password");
        var changed = a.call("POST", "/v1/auth/password/change", Map.of("currentPassword", TestUser.PASSWORD, "newPassword", "another long password"));
        assertThat(changed.getStatusCode().value()).isEqualTo(200);
        assertThat(changed.getBody()).containsEntry("deviceId", a.deviceId.toString());
        a.take(changed.getBody());
        assertThat(call("POST", "/v1/auth/refresh", Map.of("refreshToken", a.refreshToken), null).getStatusCode().value()).isEqualTo(200);
        assertThat(call("POST", "/v1/auth/refresh", Map.of("refreshToken", other.get("refreshToken")), null).getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void refreshTokensRotateAndReuseRevokesEverything() {
        TestUser a = user("rotate_me");
        var r1 = call("POST", "/v1/auth/refresh", Map.of("refreshToken", a.refreshToken), null);
        assertThat(r1.getStatusCode().value()).isEqualTo(200);
        assertThat(r1.getBody()).containsEntry("deviceId", a.deviceId.toString());
        // The old token was rotated away; presenting it again means it leaked, so every session ends.
        assertThat(call("POST", "/v1/auth/refresh", Map.of("refreshToken", a.refreshToken), null).getStatusCode().value()).isEqualTo(401);
        assertThat(call("POST", "/v1/auth/refresh", Map.of("refreshToken", r1.getBody().get("refreshToken")), null).getStatusCode().value())
                .isEqualTo(401);
    }

    @Test
    void aStaleBearerHeaderDoesNotBlockRefresh() {
        TestUser a = user("stale_bearer");
        var r = call("POST", "/v1/auth/refresh", Map.of("refreshToken", a.refreshToken), "not-a-valid-jwt");
        assertThat(r.getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void devicesCanBeListedAndSignedOut() {
        TestUser a = user("two_devices");
        Map<String, Object> second = a.loginAgain();
        List<Map<String, Object>> devices = a.get("/v1/devices");
        assertThat(devices).hasSize(2);
        assertThat(devices).filteredOn(d -> Boolean.TRUE.equals(d.get("current"))).extracting(d -> d.get("deviceId"))
                .containsExactly(a.deviceId.toString());
        assertThat(a.status("DELETE", "/v1/devices/" + second.get("deviceId"), null)).isEqualTo(200);
        assertThat(call("POST", "/v1/auth/refresh", Map.of("refreshToken", second.get("refreshToken")), null).getStatusCode().value()).isEqualTo(401);
        assertThat(a.get("/v1/devices")).hasSize(1);

        assertThat(a.status("POST", "/v1/auth/logout", null)).isEqualTo(200);
        assertThat(call("POST", "/v1/auth/refresh", Map.of("refreshToken", a.refreshToken), null).getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void newSignInsAreListedForTheAccount() {
        TestUser a = user("sign_ins");
        a.loginAgain();
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> events = (List<Map<String, Object>>) a.call("GET", "/v1/security-events", null).getBody().get("events");
        assertThat(events).extracting(e -> e.get("kind")).containsExactly("sign_in");
    }

    @Test
    void everythingElseNeedsASession() {
        assertThat(call("GET", "/v1/me", null, null).getStatusCode().value()).isEqualTo(401);
        assertThat(call("GET", "/v1/feed", null, null).getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void theWebAppOriginMayCallTheApiAndOthersMayNot() {
        var allowed = http().options().uri("/v1/auth/login").header("Origin", "https://app.example.test")
                .header("Access-Control-Request-Method", "POST").retrieve().onStatus(s -> true, (q, s) -> {}).toBodilessEntity();
        assertThat(allowed.getHeaders().getAccessControlAllowOrigin()).isEqualTo("https://app.example.test");
        var refused = http().options().uri("/v1/auth/login").header("Origin", "https://evil.example")
                .header("Access-Control-Request-Method", "POST").retrieve().onStatus(s -> true, (q, s) -> {}).toBodilessEntity();
        assertThat(refused.getHeaders().getAccessControlAllowOrigin()).isNull();
    }
}
