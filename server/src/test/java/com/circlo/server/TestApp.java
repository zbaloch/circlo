package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.circlo.server.crypto.TestClientNative;
import com.circlo.server.web.Ids;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;

/** Plays the phone app against the real server, using the real core for every client-side crypto step. */
final class TestApp {

    final IntegrationTest it;
    final String handle;
    final byte[] password;
    final byte[] identity = TestClientNative.generateIdentity();
    final byte[] device = TestClientNative.generateDeviceKeys();
    final byte[] recoveryEntropy = Ids.random(32);
    final UUID deviceId = Ids.newId();
    UUID userId;
    String accessToken;
    String refreshToken;
    byte[] exportKey;

    TestApp(IntegrationTest it, String handle, String password) {
        this.it = it;
        this.handle = handle;
        this.password = password.getBytes(StandardCharsets.UTF_8);
    }

    byte[] x25519Pub() {
        return Arrays.copyOfRange(identity, 32, 64);
    }

    byte[] ed25519Pub() {
        return Arrays.copyOfRange(identity, 96, 128);
    }

    byte[] devicePub() {
        return Arrays.copyOfRange(device, 32, 64);
    }

    /** Stand-ins for the core-sealed backups (the server treats them as opaque bytes). */
    static byte[] fakeBackup(String tag) {
        byte[] b = Ids.random(300);
        b[0] = (byte) tag.hashCode();
        return b;
    }

    ResponseEntity<Map<String, Object>> registerExpecting(int status) {
        byte[][] reg = TestClientNative.registrationStart(password);
        var start = it.call("POST", "/v1/auth/register/start", Map.of("handle", handle, "registrationRequest", reg[0]), null);
        if (start.getStatusCode().value() != 200) {
            assertThat(start.getStatusCode().value()).isEqualTo(status);
            return start;
        }
        userId = UUID.fromString((String) start.getBody().get("userId"));
        byte[] uid = Ids.bytes(userId);
        byte[][] fin = TestClientNative.registrationFinish(reg[1], password, handle, IntegrationTest.b64(start.getBody().get("registrationResponse")));
        exportKey = fin[1];
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("userId", userId.toString());
        body.put("handle", handle);
        body.put("registrationUpload", fin[0]);
        body.put("recoveryPubkey", TestClientNative.recoveryPublicKey(recoveryEntropy));
        body.put("identity", Map.of("x25519Pub", x25519Pub(), "ed25519Pub", ed25519Pub(),
                "signature", TestClientNative.signIdentity(identity, uid, 1), "version", 1));
        body.put("device", Map.of("deviceId", deviceId.toString(), "devicePubkey", devicePub(),
                "deviceCert", TestClientNative.signDeviceCertificate(identity, uid, Ids.bytes(deviceId), devicePub())));
        body.put("passwordBackup", fakeBackup("password"));
        body.put("recoveryBackup", fakeBackup("recovery"));
        var done = it.call("POST", "/v1/auth/register/finish", body, null);
        assertThat(done.getStatusCode().value()).isEqualTo(status);
        if (status == 200) {
            accessToken = (String) done.getBody().get("accessToken");
            refreshToken = (String) done.getBody().get("refreshToken");
        }
        return done;
    }

    TestApp register() {
        registerExpecting(200);
        return this;
    }

    /** Logs in from a fresh "device"; returns the server's response to the finalization. */
    ResponseEntity<Map<String, Object>> login(String pw) {
        byte[] pwBytes = pw.getBytes(StandardCharsets.UTF_8);
        byte[][] login = TestClientNative.loginStart(pwBytes);
        var start = it.call("POST", "/v1/auth/login/start", Map.of("handle", handle, "credentialRequest", login[0]), null);
        assertThat(start.getStatusCode().value()).isEqualTo(200);
        byte[][] fin = TestClientNative.loginFinish(login[1], pwBytes, handle, IntegrationTest.b64(start.getBody().get("credentialResponse")));
        exportKey = fin[1];
        var done = it.call("POST", "/v1/auth/login/finish",
                Map.of("loginId", start.getBody().get("loginId"), "handle", handle, "credentialFinalization", fin[0]), null);
        if (done.getStatusCode().value() == 200) {
            accessToken = (String) done.getBody().get("accessToken");
            refreshToken = (String) done.getBody().get("refreshToken");
        }
        return done;
    }
}
