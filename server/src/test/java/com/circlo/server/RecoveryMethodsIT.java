package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.circlo.server.crypto.TestClientNative;
import com.circlo.server.web.Ids;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/**
 * Recovery methods (docs/PASSKEY_RECOVERY.md): a user has one or more, each a public key plus a recovery copy of the key
 * backup. To the server a passkey method is just another key; the tests derive both kinds with the phrase derivation.
 */
class RecoveryMethodsIT extends IntegrationTest {

    private static Map<String, Object> method(String kind, byte[] root, byte[] backup) {
        return Map.of("kind", kind, "authPubkey", TestClientNative.recoveryPublicKey(root), "ciphertext", backup);
    }

    /** A full recovery login with `root`; returns the finish response. */
    private ResponseEntity<Map<String, Object>> recover(TestApp a, byte[] root) {
        var start = call("POST", "/v1/auth/recovery/start", Map.of("handle", a.handle), null);
        UUID challengeId = UUID.fromString((String) start.getBody().get("challengeId"));
        long expiresAt = ((Number) start.getBody().get("expiresAt")).longValue();
        byte[] sig = TestClientNative.signRecoveryLogin(root, Ids.bytes(a.userId), Ids.bytes(challengeId),
                b64(start.getBody().get("nonce")), expiresAt);
        return call("POST", "/v1/auth/recovery/finish", Map.of("challengeId", challengeId.toString(), "signature", sig), null);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> methods(TestApp a) {
        return (List<Map<String, Object>>) call("GET", "/v1/recovery-methods", null, a.accessToken).getBody().get("methods");
    }

    /** Proves the current password and returns the one-time token that removing a method needs. */
    private String reauth(TestApp a, String password) {
        byte[] pw = password.getBytes(StandardCharsets.UTF_8);
        byte[][] login = TestClientNative.loginStart(pw);
        var start = call("POST", "/v1/auth/password/verify/start", Map.of("handle", a.handle, "credentialRequest", login[0]), a.accessToken);
        byte[][] fin = TestClientNative.loginFinish(login[1], pw, a.handle, b64(start.getBody().get("credentialResponse")));
        var done = call("POST", "/v1/auth/password/verify/finish",
                Map.of("loginId", start.getBody().get("loginId"), "handle", a.handle, "credentialFinalization", fin[0]), a.accessToken);
        assertThat(done.getStatusCode().value()).isEqualTo(200);
        return (String) done.getBody().get("reauthToken");
    }

    private int remove(TestApp a, Object methodId, String reauthToken) {
        var spec = http().delete().uri("/v1/recovery-methods/" + methodId).header("Authorization", "Bearer " + a.accessToken);
        if (reauthToken != null) {
            spec = spec.header("X-Circlo-Reauth", reauthToken);
        }
        return spec.retrieve().onStatus(x -> true, (q, r) -> {}).toBodilessEntity().getStatusCode().value();
    }

    @Test
    void signUpWithAPasskeyAndAPhraseThenRecoverWithEither() {
        byte[] phraseRoot = Ids.random(32);
        byte[] passkeyRoot = Ids.random(32);
        byte[] passkeyCopy = TestApp.fakeBackup("passkey");
        TestApp a = new TestApp(this, "rm_ann", "ann's password");
        a.recoveryMethods = List.of(method("passkey", passkeyRoot, passkeyCopy), method("phrase", phraseRoot, TestApp.fakeBackup("phrase")));
        a.register();

        List<Map<String, Object>> listed = methods(a);
        assertThat(listed).extracting(m -> m.get("kind")).containsExactlyInAnyOrder("passkey", "phrase");
        // Only what the Settings screen shows: no keys, no ciphertext.
        assertThat(listed.get(0).keySet()).containsExactlyInAnyOrder("id", "kind", "createdAt", "lastUsedAt");

        var rec = recover(a, passkeyRoot);
        assertThat(rec.getStatusCode().value()).isEqualTo(200);
        assertThat(rec.getBody()).containsEntry("scope", "recovery").containsEntry("methodKind", "passkey");
        String token = (String) rec.getBody().get("accessToken");
        var copy = call("GET", "/v1/recovery-methods/" + rec.getBody().get("methodId") + "/backup", null, token);
        assertThat(b64(copy.getBody().get("ciphertext"))).isEqualTo(passkeyCopy);
        // A recovery token still can't reach the password copy or anything else.
        assertThat(call("GET", "/v1/backups/password", null, token).getStatusCode().value()).isEqualTo(403);
        assertThat(call("GET", "/v1/recovery-methods", null, token).getStatusCode().value()).isEqualTo(403);

        assertThat(recover(a, phraseRoot).getBody()).containsEntry("methodKind", "phrase");
        assertThat(recover(a, Ids.random(32)).getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void signUpNeedsARecoveryMethod() {
        TestApp a = new TestApp(this, "rm_none", "pw");
        a.recoveryMethods = List.of();
        a.registerExpecting(400);
    }

    @Test
    void olderAppsStillSignUpAndRecoverWithAPhrase() {
        TestApp a = new TestApp(this, "rm_old", "pw").register(); // the single recoveryPubkey/recoveryBackup fields
        assertThat(methods(a)).extracting(m -> m.get("kind")).containsExactly("phrase");
        var rec = recover(a, a.recoveryEntropy);
        assertThat(rec.getStatusCode().value()).isEqualTo(200);
        String token = (String) rec.getBody().get("accessToken");
        assertThat(call("GET", "/v1/backups/recovery", null, token).getStatusCode().value()).isEqualTo(200);
    }

    @Test
    void addAPasskeyWrapAndRemoveMethodsWithThePasswordButNeverTheLastOne() {
        byte[] phraseRoot = Ids.random(32);
        TestApp a = new TestApp(this, "rm_bea", "bea's password");
        a.recoveryMethods = List.of(method("phrase", phraseRoot, TestApp.fakeBackup("phrase")));
        a.register();

        // Adding Face ID recovery (or another wrap of it) needs only the session.
        byte[] passkeyRoot = Ids.random(32);
        var added = call("POST", "/v1/recovery-methods", method("passkey", passkeyRoot, TestApp.fakeBackup("passkey")), a.accessToken);
        assertThat(added.getStatusCode().value()).isEqualTo(201);
        assertThat(recover(a, passkeyRoot).getBody()).containsEntry("methodKind", "passkey");
        assertThat(call("POST", "/v1/recovery-methods", Map.of("kind", "email", "authPubkey", Ids.random(32), "ciphertext", Ids.random(64)),
                a.accessToken).getStatusCode().value()).isEqualTo(400);

        // Removing one needs the password, proved just before (single use).
        Object phraseId = methods(a).stream().filter(m -> m.get("kind").equals("phrase")).findFirst().orElseThrow().get("id");
        assertThat(remove(a, phraseId, null)).isEqualTo(403);
        assertThat(remove(a, phraseId, "not-a-token")).isEqualTo(403);
        String token = reauth(a, "bea's password");
        assertThat(remove(a, phraseId, token)).isEqualTo(200);
        assertThat(remove(a, added.getBody().get("id"), token)).isEqualTo(403); // already used
        assertThat(recover(a, phraseRoot).getStatusCode().value()).isEqualTo(401);

        // The last method stays: an account always has a way back in besides the password.
        assertThat(remove(a, added.getBody().get("id"), reauth(a, "bea's password"))).isEqualTo(409);

        // Someone else's method is invisible.
        TestApp other = new TestApp(this, "rm_cat", "pw").register();
        assertThat(remove(other, added.getBody().get("id"), reauth(other, "pw"))).isEqualTo(404);
    }
}
