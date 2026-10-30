package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.circlo.server.crypto.CoreException;
import com.circlo.server.crypto.TestClientNative;
import com.circlo.server.web.Ids;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/** Phase 3: signup, login, sessions, key backups, devices, identity keys, recovery, login lockout, sign-in alerts. */
class AuthFlowIT extends IntegrationTest {

    @Test
    void signupOnDeviceAThenLoginOnDeviceBGivesSameIdentityAndBackup() {
        TestApp a = new TestApp(this, "alice_flow", "a long passphrase").register();
        byte[] exportKeyA = a.exportKey;
        var backupA = call("GET", "/v1/backups/password", null, a.accessToken);
        assertThat(backupA.getStatusCode().value()).isEqualTo(200);

        TestApp b = new TestApp(this, "Alice_Flow", "a long passphrase"); // device B, same account, handle case differs
        var login = b.login("a long passphrase");
        assertThat(login.getStatusCode().value()).isEqualTo(200);
        assertThat(login.getBody().get("userId")).isEqualTo(a.userId.toString());
        assertThat(b.exportKey).isEqualTo(exportKeyA); // same key → same backup decryption key on both devices
        var backupB = call("GET", "/v1/backups/password", null, b.accessToken);
        assertThat(backupB.getBody().get("ciphertext")).isEqualTo(backupA.getBody().get("ciphertext"));

        var identity = call("GET", "/v1/users/" + a.userId + "/identity", null, b.accessToken);
        assertThat(b64(identity.getBody().get("ed25519Pub"))).isEqualTo(a.ed25519Pub());
    }

    @Test
    void wrongPasswordCannotLogIn() {
        TestApp a = new TestApp(this, "bob_wrongpw", "right password").register();
        byte[] pw = "wrong password".getBytes(StandardCharsets.UTF_8);
        byte[][] login = TestClientNative.loginStart(pw);
        var start = call("POST", "/v1/auth/login/start", Map.of("handle", a.handle, "credentialRequest", login[0]), null);
        assertThatThrownBy(() -> TestClientNative.loginFinish(login[1], pw, a.handle, b64(start.getBody().get("credentialResponse"))))
                .isInstanceOf(CoreException.class);
        // A forged finalization is rejected by the server too.
        var forged = call("POST", "/v1/auth/login/finish",
                Map.of("loginId", start.getBody().get("loginId"), "handle", a.handle, "credentialFinalization", Ids.random(64)), null);
        assertThat(forged.getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void loginStateIsSingleUse() {
        TestApp a = new TestApp(this, "carol_replay", "pw for carol").register();
        byte[] pw = "pw for carol".getBytes(StandardCharsets.UTF_8);
        byte[][] login = TestClientNative.loginStart(pw);
        var start = call("POST", "/v1/auth/login/start", Map.of("handle", a.handle, "credentialRequest", login[0]), null);
        byte[][] fin = TestClientNative.loginFinish(login[1], pw, a.handle, b64(start.getBody().get("credentialResponse")));
        Map<String, Object> finish = Map.of("loginId", start.getBody().get("loginId"), "handle", a.handle, "credentialFinalization", fin[0]);
        assertThat(call("POST", "/v1/auth/login/finish", finish, null).getStatusCode().value()).isEqualTo(200);
        assertThat(call("POST", "/v1/auth/login/finish", finish, null).getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void unknownHandlesLookLikeRealOnes() {
        new TestApp(this, "dave_real", "pw").register();
        byte[][] login = TestClientNative.loginStart("pw".getBytes(StandardCharsets.UTF_8));
        var known = call("POST", "/v1/auth/login/start", Map.of("handle", "dave_real", "credentialRequest", login[0]), null);
        var unknown = call("POST", "/v1/auth/login/start", Map.of("handle", "nobody_at_all", "credentialRequest", login[0]), null);
        assertThat(unknown.getStatusCode().value()).isEqualTo(200);
        assertThat(b64(unknown.getBody().get("credentialResponse")).length)
                .isEqualTo(b64(known.getBody().get("credentialResponse")).length);
        var rec = call("POST", "/v1/auth/recovery/start", Map.of("handle", "nobody_at_all"), null);
        assertThat(rec.getStatusCode().value()).isEqualTo(200);
        assertThat(rec.getBody()).containsKeys("userId", "challengeId", "nonce", "expiresAt");
    }

    @Test
    void handleIsUniqueAndValidated() {
        new TestApp(this, "erin_unique", "pw").register();
        new TestApp(this, "ERIN_UNIQUE", "other").registerExpecting(409);
        var bad = call("POST", "/v1/auth/register/start", Map.of("handle", "no spaces!", "registrationRequest", Ids.random(32)), null);
        assertThat(bad.getStatusCode().value()).isEqualTo(400);
        assertThat(bad.getBody()).isEqualTo(Map.of("error", "invalid_handle"));
    }

    @Test
    void abandonedSignupDoesNotBlockTheHandle() {
        // Start signup and abandon it (e.g. closed the app on the recovery-phrase screen).
        TestApp first = new TestApp(this, "kim_abandon", "first attempt pw");
        byte[][] reg = TestClientNative.registrationStart(first.password);
        var start = call("POST", "/v1/auth/register/start", Map.of("handle", first.handle, "registrationRequest", reg[0]), null);
        assertThat(start.getStatusCode().value()).isEqualTo(200);
        String abandonedUserId = (String) start.getBody().get("userId");

        // No account exists yet: logging in fails like any unknown handle.
        assertThatThrownBy(() -> new TestApp(this, "kim_abandon", "x").login("first attempt pw")).isInstanceOf(CoreException.class);

        // Starting again with the same handle works immediately and completes normally.
        TestApp second = new TestApp(this, "kim_abandon", "second attempt pw").register();
        assertThat(second.userId.toString()).isNotEqualTo(abandonedUserId);
        assertThat(new TestApp(this, "kim_abandon", "second attempt pw").login("second attempt pw").getStatusCode().value())
                .isEqualTo(200);

        // Once the account is complete, the handle is taken for good.
        new TestApp(this, "kim_abandon", "third").registerExpecting(409);
    }

    @Test
    void refreshTokensRotateAndCannotBeReused() {
        TestApp a = new TestApp(this, "frank_refresh", "pw").register();
        String old = a.refreshToken;
        var r1 = call("POST", "/v1/auth/refresh", Map.of("refreshToken", old), null);
        assertThat(r1.getStatusCode().value()).isEqualTo(200);
        assertThat(r1.getBody().get("refreshToken")).isNotEqualTo(old);
        assertThat(call("POST", "/v1/auth/refresh", Map.of("refreshToken", old), null).getStatusCode().value()).isEqualTo(401);
    }

    /**
     * A refresh happens because the access token expired, and clients may still send that token: a stale or invalid
     * Bearer header must never block the public auth endpoints (it used to: 401 before the endpoint ran).
     */
    @Test
    void staleBearerHeaderDoesNotBlockRefresh() {
        TestApp a = new TestApp(this, "harry_stale", "pw").register();
        var r = http().post().uri("/v1/auth/refresh")
                .header("Authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4IiwiZXhwIjoxfQ.expired")
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON).body(Map.of("refreshToken", a.refreshToken))
                .retrieve().onStatus(s -> true, (req, res) -> {}).toBodilessEntity();
        assertThat(r.getStatusCode().value()).isEqualTo(200);
        // Protected endpoints still reject a bad token.
        assertThat(call("GET", "/v1/friends", null, "not-a-jwt").getStatusCode().value()).isEqualTo(401);
    }

    /** RFC 9700 section 4.14.2: reuse of a rotated refresh token means it leaked, so every session of the user ends. */
    @Test
    void reusingARotatedRefreshTokenRevokesAllSessions() {
        TestApp a = new TestApp(this, "grace_reuse", "pw").register();
        String old = a.refreshToken;
        String current = (String) call("POST", "/v1/auth/refresh", Map.of("refreshToken", old), null)
                .getBody().get("refreshToken");
        assertThat(a.login("pw").getStatusCode().value()).isEqualTo(200);
        String otherSession = a.refreshToken;

        assertThat(call("POST", "/v1/auth/refresh", Map.of("refreshToken", old), null).getStatusCode().value()).isEqualTo(401);

        assertThat(call("POST", "/v1/auth/refresh", Map.of("refreshToken", current), null).getStatusCode().value()).isEqualTo(401);
        assertThat(call("POST", "/v1/auth/refresh", Map.of("refreshToken", otherSession), null).getStatusCode().value())
                .isEqualTo(401);
    }

    @Test
    void recoveryPhraseResetsThePassword() {
        TestApp a = new TestApp(this, "gina_recover", "forgotten password").register();
        var start = call("POST", "/v1/auth/recovery/start", Map.of("handle", a.handle), null);
        UUID userId = UUID.fromString((String) start.getBody().get("userId"));
        assertThat(userId).isEqualTo(a.userId);
        UUID challengeId = UUID.fromString((String) start.getBody().get("challengeId"));
        long expiresAt = ((Number) start.getBody().get("expiresAt")).longValue();
        byte[] sig = TestClientNative.signRecoveryLogin(a.recoveryEntropy, Ids.bytes(userId), Ids.bytes(challengeId),
                b64(start.getBody().get("nonce")), expiresAt);

        // A signature from the wrong phrase fails.
        byte[] wrongSig = TestClientNative.signRecoveryLogin(Ids.random(32), Ids.bytes(userId), Ids.bytes(challengeId),
                b64(start.getBody().get("nonce")), expiresAt);
        assertThat(call("POST", "/v1/auth/recovery/finish", Map.of("challengeId", challengeId.toString(), "signature", wrongSig), null)
                .getStatusCode().value()).isEqualTo(401);

        // The challenge was consumed by the failed attempt; start again with the right phrase.
        start = call("POST", "/v1/auth/recovery/start", Map.of("handle", a.handle), null);
        challengeId = UUID.fromString((String) start.getBody().get("challengeId"));
        expiresAt = ((Number) start.getBody().get("expiresAt")).longValue();
        sig = TestClientNative.signRecoveryLogin(a.recoveryEntropy, Ids.bytes(userId), Ids.bytes(challengeId),
                b64(start.getBody().get("nonce")), expiresAt);
        var rec = call("POST", "/v1/auth/recovery/finish", Map.of("challengeId", challengeId.toString(), "signature", sig), null);
        assertThat(rec.getStatusCode().value()).isEqualTo(200);
        assertThat(rec.getBody().get("scope")).isEqualTo("recovery");
        String recoveryToken = (String) rec.getBody().get("accessToken");

        // A recovery token reads the recovery backup only.
        assertThat(call("GET", "/v1/backups/recovery", null, recoveryToken).getStatusCode().value()).isEqualTo(200);
        assertThat(call("GET", "/v1/backups/password", null, recoveryToken).getStatusCode().value()).isEqualTo(403);
        assertThat(call("GET", "/v1/devices", null, recoveryToken).getStatusCode().value()).isEqualTo(403);

        // Set a new password (OPAQUE re-registration) and upload a new password backup.
        byte[] newPw = "brand new password".getBytes(StandardCharsets.UTF_8);
        byte[][] reg = TestClientNative.registrationStart(newPw);
        var ps = call("POST", "/v1/auth/password/start", Map.of("handle", a.handle, "registrationRequest", reg[0]), recoveryToken);
        assertThat(ps.getStatusCode().value()).isEqualTo(200);
        byte[][] fin = TestClientNative.registrationFinish(reg[1], newPw, a.handle, b64(ps.getBody().get("registrationResponse")));
        var pf = call("POST", "/v1/auth/password/finish", Map.of("registrationUpload", fin[0], "passwordBackup", TestApp.fakeBackup("new")), recoveryToken);
        assertThat(pf.getStatusCode().value()).isEqualTo(200);
        assertThat(pf.getBody().get("scope")).isEqualTo("full");

        // Old sessions are revoked; the new password works, the old one doesn't.
        assertThat(call("POST", "/v1/auth/refresh", Map.of("refreshToken", a.refreshToken), null).getStatusCode().value()).isEqualTo(401);
        TestApp again = new TestApp(this, a.handle, "brand new password");
        assertThat(again.login("brand new password").getStatusCode().value()).isEqualTo(200);
        assertThatThrownBy(() -> new TestApp(this, a.handle, "x").login("forgotten password")).isInstanceOf(CoreException.class);
    }

    @Test
    void forgedIdentityOrDeviceSignaturesAreRejectedAtSignup() {
        TestApp a = new TestApp(this, "hank_forged", "pw");
        byte[][] reg = TestClientNative.registrationStart(a.password);
        var start = call("POST", "/v1/auth/register/start", Map.of("handle", a.handle, "registrationRequest", reg[0]), null);
        UUID userId = UUID.fromString((String) start.getBody().get("userId"));
        byte[][] fin = TestClientNative.registrationFinish(reg[1], a.password, a.handle, b64(start.getBody().get("registrationResponse")));
        byte[] uid = Ids.bytes(userId);
        Map<String, Object> body = new java.util.HashMap<>(Map.of(
                "userId", userId.toString(), "handle", a.handle, "registrationUpload", fin[0],
                "recoveryPubkey", TestClientNative.recoveryPublicKey(a.recoveryEntropy),
                "identity", Map.of("x25519Pub", a.x25519Pub(), "ed25519Pub", a.ed25519Pub(),
                        "signature", TestClientNative.signIdentity(a.identity, Ids.random(16), 1), "version", 1),
                "device", Map.of("deviceId", a.deviceId.toString(), "devicePubkey", a.devicePub(),
                        "deviceCert", TestClientNative.signDeviceCertificate(a.identity, uid, Ids.bytes(a.deviceId), a.devicePub())),
                "passwordBackup", TestApp.fakeBackup("p"), "recoveryBackup", TestApp.fakeBackup("r")));
        assertThat(call("POST", "/v1/auth/register/finish", body, null).getBody()).isEqualTo(Map.of("error", "bad_identity_signature"));
        body.put("identity", Map.of("x25519Pub", a.x25519Pub(), "ed25519Pub", a.ed25519Pub(),
                "signature", TestClientNative.signIdentity(a.identity, uid, 1), "version", 1));
        body.put("device", Map.of("deviceId", a.deviceId.toString(), "devicePubkey", a.devicePub(), "deviceCert", Ids.random(64)));
        assertThat(call("POST", "/v1/auth/register/finish", body, null).getBody()).isEqualTo(Map.of("error", "bad_device_certificate"));
    }

    @Test
    void devicesAndBackupsRequireAuthAndVersioning() {
        assertThat(call("GET", "/v1/devices", null, null).getStatusCode().value()).isEqualTo(401);
        assertThat(call("GET", "/v1/devices", null, "not-a-jwt").getStatusCode().value()).isEqualTo(401);

        TestApp a = new TestApp(this, "ivy_devices", "pw").register();
        UUID second = Ids.newId();
        byte[] dev2 = TestClientNative.generateDeviceKeys();
        byte[] dev2Pub = java.util.Arrays.copyOfRange(dev2, 32, 64);
        byte[] cert = TestClientNative.signDeviceCertificate(a.identity, Ids.bytes(a.userId), Ids.bytes(second), dev2Pub);
        assertThat(call("POST", "/v1/devices", Map.of("deviceId", second.toString(), "devicePubkey", dev2Pub, "deviceCert", cert), a.accessToken)
                .getStatusCode().value()).isEqualTo(201);
        assertThat(call("POST", "/v1/devices", Map.of("deviceId", Ids.newId().toString(), "devicePubkey", dev2Pub, "deviceCert", cert), a.accessToken)
                .getStatusCode().value()).isEqualTo(400);
        @SuppressWarnings("unchecked")
        List<Object> devices = (List<Object>) (Object) http().get().uri("/v1/devices").header("Authorization", "Bearer " + a.accessToken)
                .retrieve().body(List.class);
        assertThat(devices).hasSize(2);

        assertThat(call("PUT", "/v1/backups/password", Map.of("ciphertext", Ids.random(100), "version", 3), a.accessToken)
                .getStatusCode().value()).isEqualTo(409);
        assertThat(call("PUT", "/v1/backups/password", Map.of("ciphertext", Ids.random(100), "version", 2), a.accessToken)
                .getStatusCode().value()).isEqualTo(200);
        assertThat(call("GET", "/v1/backups/whatever", null, a.accessToken).getStatusCode().value()).isEqualTo(404);
    }

    /** One login with the wrong password: the start goes through, then the phone's OPAQUE finish fails. */
    private ResponseEntity<Map<String, Object>> wrongPasswordAttempt(String handle) {
        byte[] pw = "not the password".getBytes(StandardCharsets.UTF_8);
        byte[][] login = TestClientNative.loginStart(pw);
        var start = call("POST", "/v1/auth/login/start", Map.of("handle", handle, "credentialRequest", login[0]), null);
        if (start.getStatusCode().value() == 200) {
            assertThatThrownBy(() -> TestClientNative.loginFinish(login[1], pw, handle, b64(start.getBody().get("credentialResponse"))))
                    .isInstanceOf(CoreException.class);
        }
        return start;
    }

    @Test
    void threeWrongPasswordsLockPasswordLoginButNotTheRecoveryPhrase() {
        TestApp a = new TestApp(this, "jack_locked", "the right password").register();
        assertThat(wrongPasswordAttempt(a.handle).getBody().get("attemptsLeft")).isEqualTo(2);
        assertThat(wrongPasswordAttempt(a.handle).getBody().get("attemptsLeft")).isEqualTo(1);
        var last = wrongPasswordAttempt(a.handle).getBody();
        assertThat(last.get("attemptsLeft")).isEqualTo(0);
        assertThat(((Number) last.get("lockSeconds")).longValue()).isBetween(890L, 900L);

        // Locked for 15 minutes, even with the right password.
        var locked = wrongPasswordAttempt(a.handle);
        assertThat(locked.getStatusCode().value()).isEqualTo(429);
        assertThat(locked.getBody().get("error")).isEqualTo("locked");
        assertThat(((Number) locked.getBody().get("retryAfter")).longValue()).isBetween(800L, 900L);
        assertThat(locked.getHeaders().getFirst("Retry-After")).isNotNull();
        assertThatThrownBy(() -> new TestApp(this, a.handle, "the right password").login("the right password"))
                .isInstanceOf(AssertionError.class);

        // The recovery phrase still works, and setting a new password lifts the lock.
        String recoveryToken = recoveryLogin(a);
        resetPassword(a, recoveryToken, "a new strong password");
        assertThat(new TestApp(this, a.handle, "x").login("a new strong password").getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void aSuccessfulLoginStartsTheCountAgain() {
        TestApp a = new TestApp(this, "kate_retry", "kate's password").register();
        wrongPasswordAttempt(a.handle);
        wrongPasswordAttempt(a.handle);
        assertThat(a.login("kate's password").getStatusCode().value()).isEqualTo(200);
        assertThat(wrongPasswordAttempt(a.handle).getBody().get("attemptsLeft")).isEqualTo(2);
    }

    @Test
    void unknownHandlesLockTheSameWay() {
        for (int i = 0; i < 3; i++) {
            assertThat(wrongPasswordAttempt("nobody_here").getStatusCode().value()).isEqualTo(200);
        }
        assertThat(wrongPasswordAttempt("nobody_here").getBody().get("error")).isEqualTo("locked");
    }

    @Test
    void otherDevicesSeeANewSignIn() {
        TestApp a = new TestApp(this, "liam_alert", "liam's password").register();
        assertThat((List<?>) call("GET", "/v1/security-events", null, a.accessToken).getBody().get("events")).isEmpty();

        TestApp phone2 = new TestApp(this, a.handle, "liam's password");
        assertThat(phone2.login("liam's password").getStatusCode().value()).isEqualTo(200);

        List<?> events = (List<?>) call("GET", "/v1/security-events", null, a.accessToken).getBody().get("events");
        assertThat(events).hasSize(1);
        @SuppressWarnings("unchecked")
        Map<String, Object> e = (Map<String, Object>) events.get(0);
        assertThat(e.get("kind")).isEqualTo("sign_in");
        assertThat(e.keySet()).containsExactlyInAnyOrder("id", "kind", "createdAt"); // nothing about the device or network
        assertThat(call("GET", "/v1/security-events", null, null).getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void changingThePasswordProvesTheCurrentOneWithoutASignInAlert() {
        TestApp a = new TestApp(this, "mia_change", "mia's old password").register();
        byte[] current = "mia's old password".getBytes(StandardCharsets.UTF_8);

        // Proving the current password needs this account's session, and the handle must be its own.
        byte[][] login = TestClientNative.loginStart(current);
        assertThat(call("POST", "/v1/auth/password/verify/start", Map.of("handle", a.handle, "credentialRequest", login[0]), null)
                .getStatusCode().value()).isEqualTo(401);
        TestApp other = new TestApp(this, "noah_other", "noah's password").register();
        assertThat(call("POST", "/v1/auth/password/verify/start", Map.of("handle", other.handle, "credentialRequest", login[0]), a.accessToken)
                .getStatusCode().value()).isEqualTo(403);

        var start = call("POST", "/v1/auth/password/verify/start", Map.of("handle", a.handle, "credentialRequest", login[0]), a.accessToken);
        assertThat(start.getStatusCode().value()).isEqualTo(200);
        assertThat(start.getBody().get("attemptsLeft")).isEqualTo(2);
        byte[][] fin = TestClientNative.loginFinish(login[1], current, a.handle, b64(start.getBody().get("credentialResponse")));
        var verified = call("POST", "/v1/auth/password/verify/finish",
                Map.of("loginId", start.getBody().get("loginId"), "handle", a.handle, "credentialFinalization", fin[0]), a.accessToken);
        assertThat(verified.getStatusCode().value()).isEqualTo(204);
        resetPassword(a, a.accessToken, "mia's new password");

        // Her own password change is not "a new sign-in", and the new password works.
        TestApp again = new TestApp(this, a.handle, "x");
        assertThat(again.login("mia's new password").getStatusCode().value()).isEqualTo(200);
        List<?> events = (List<?>) call("GET", "/v1/security-events", null, again.accessToken).getBody().get("events");
        assertThat(events).hasSize(1); // only the login just above
    }

    private String recoveryLogin(TestApp a) {
        var start = call("POST", "/v1/auth/recovery/start", Map.of("handle", a.handle), null);
        UUID challengeId = UUID.fromString((String) start.getBody().get("challengeId"));
        long expiresAt = ((Number) start.getBody().get("expiresAt")).longValue();
        byte[] sig = TestClientNative.signRecoveryLogin(a.recoveryEntropy, Ids.bytes(a.userId), Ids.bytes(challengeId),
                b64(start.getBody().get("nonce")), expiresAt);
        var rec = call("POST", "/v1/auth/recovery/finish", Map.of("challengeId", challengeId.toString(), "signature", sig), null);
        assertThat(rec.getStatusCode().value()).isEqualTo(200);
        return (String) rec.getBody().get("accessToken");
    }

    private void resetPassword(TestApp a, String token, String password) {
        byte[] pw = password.getBytes(StandardCharsets.UTF_8);
        byte[][] reg = TestClientNative.registrationStart(pw);
        var ps = call("POST", "/v1/auth/password/start", Map.of("handle", a.handle, "registrationRequest", reg[0]), token);
        byte[][] fin = TestClientNative.registrationFinish(reg[1], pw, a.handle, b64(ps.getBody().get("registrationResponse")));
        assertThat(call("POST", "/v1/auth/password/finish", Map.of("registrationUpload", fin[0], "passwordBackup", TestApp.fakeBackup("reset")), token)
                .getStatusCode().value()).isEqualTo(200);
    }
}
