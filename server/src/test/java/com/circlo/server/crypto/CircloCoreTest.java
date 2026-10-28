package com.circlo.server.crypto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** JNI round trips into circlo-core (no Spring, no database). */
class CircloCoreTest {

    private static CircloCore core;
    private static final SecureRandom RANDOM = new SecureRandom();

    @BeforeAll
    static void load() {
        core = new CircloCore(System.getProperty("circlo.core.library", ""));
    }

    private static byte[] random(int n) {
        byte[] b = new byte[n];
        RANDOM.nextBytes(b);
        return b;
    }

    private static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    @Test
    void opaqueRegisterThenLoginThroughJni() {
        byte[] setup = core.opaqueServerSetupNew();
        byte[] handleKey = random(32);
        byte[] credId = core.handleLookup(handleKey, "Alice_Test");
        byte[] pw = utf8("correct horse battery staple");

        byte[][] reg = TestClientNative.registrationStart(pw);
        byte[] resp = core.opaqueRegistrationStart(setup, credId, reg[0]);
        byte[][] fin = TestClientNative.registrationFinish(reg[1], pw, "alice_test", resp);
        byte[] record = core.opaqueRegistrationFinish(fin[0]);

        byte[][] login = TestClientNative.loginStart(pw);
        CircloCore.LoginStart start = core.opaqueLoginStart(setup, record, credId, "alice_test", login[0]);
        byte[][] done = TestClientNative.loginFinish(login[1], pw, "alice_test", start.response());
        assertThat(core.opaqueLoginFinish(start.state(), "alice_test", done[0])).isTrue();
        assertThat(done[1]).isEqualTo(fin[1]).hasSize(64);

        // Wrong password: the client can't finish, and a forged finalization doesn't pass the server.
        byte[][] wrong = TestClientNative.loginStart(utf8("wrong"));
        CircloCore.LoginStart wrongStart = core.opaqueLoginStart(setup, record, credId, "alice_test", wrong[0]);
        assertThatThrownBy(() -> TestClientNative.loginFinish(wrong[1], utf8("wrong"), "alice_test", wrongStart.response()))
                .isInstanceOf(CoreException.class)
                .hasMessage("AuthFailed");
        assertThat(core.opaqueLoginFinish(wrongStart.state(), "alice_test", random(64))).isFalse();
    }

    @Test
    void unknownHandleGetsAFakeResponseOfTheSameSize() {
        byte[] setup = core.opaqueServerSetupNew();
        byte[][] login = TestClientNative.loginStart(utf8("pw"));
        CircloCore.LoginStart fake = core.opaqueLoginStart(setup, null, random(32), "nobody_here", login[0]);
        assertThat(fake.response()).isNotEmpty();
        assertThatThrownBy(() -> TestClientNative.loginFinish(login[1], utf8("pw"), "nobody_here", fake.response()))
                .isInstanceOf(CoreException.class);
    }

    @Test
    void handleLookupIsKeyedAndNormalized() {
        byte[] key = random(32);
        assertThat(core.handleLookup(key, "Alice_Test")).isEqualTo(core.handleLookup(key, " alice_test "));
        assertThat(core.handleLookup(key, "alice_test")).isNotEqualTo(core.handleLookup(random(32), "alice_test"));
        assertThatThrownBy(() -> core.handleLookup(key, "no spaces allowed"))
                .isInstanceOf(CoreException.class)
                .hasMessage("InvalidInput");
    }

    @Test
    void identityAndDeviceSignatures() {
        byte[] identity = TestClientNative.generateIdentity();
        byte[] x = Arrays.copyOfRange(identity, 32, 64);
        byte[] ed = Arrays.copyOfRange(identity, 96, 128);
        byte[] userId = random(16);
        byte[] sig = TestClientNative.signIdentity(identity, userId, 1);
        assertThat(core.verifyIdentity(ed, userId, 1, x, sig)).isTrue();
        assertThat(core.verifyIdentity(ed, random(16), 1, x, sig)).isFalse();
        assertThat(core.verifyIdentity(ed, userId, 1, x, random(64))).isFalse();
        assertThat(core.verifyIdentity(ed, userId, 1, x, new byte[3])).isFalse();

        byte[] dev = TestClientNative.generateDeviceKeys();
        byte[] devPk = Arrays.copyOfRange(dev, 32, 64);
        byte[] deviceId = random(16);
        byte[] cert = TestClientNative.signDeviceCertificate(identity, userId, deviceId, devPk);
        assertThat(core.verifyDeviceCertificate(ed, userId, deviceId, devPk, cert)).isTrue();
        assertThat(core.verifyDeviceCertificate(ed, userId, random(16), devPk, cert)).isFalse();
    }

    @Test
    void recoveryLoginSignature() {
        byte[] entropy = random(32);
        byte[] pk = TestClientNative.recoveryPublicKey(entropy);
        byte[] userId = random(16);
        byte[] challenge = random(16);
        byte[] nonce = random(32);
        byte[] sig = TestClientNative.signRecoveryLogin(entropy, userId, challenge, nonce, 1_900_000_000L);
        assertThat(core.verifyRecoveryLogin(pk, userId, challenge, nonce, 1_900_000_000L, sig)).isTrue();
        assertThat(core.verifyRecoveryLogin(pk, userId, challenge, nonce, 1_900_000_001L, sig)).isFalse();
    }

    @Test
    void pushTokensAreSealed() {
        byte[] key = random(32);
        byte[] deviceId = random(16);
        byte[] token = utf8("fcm-token-test-only");
        byte[] ct = core.sealPushToken(key, deviceId, token);
        assertThat(new String(ct, StandardCharsets.ISO_8859_1)).doesNotContain("fcm-token");
        assertThat(core.openPushToken(key, deviceId, ct)).isEqualTo(token);
        assertThatThrownBy(() -> core.openPushToken(key, random(16), ct))
                .isInstanceOf(CoreException.class)
                .hasMessage("DecryptionFailed");
    }
}
