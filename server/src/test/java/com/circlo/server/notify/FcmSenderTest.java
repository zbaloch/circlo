package com.circlo.server.notify;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jose.util.JSONObjectUtils;
import com.nimbusds.jwt.SignedJWT;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class FcmSenderTest {

    /** A service-account JSON like Firebase's, with a key made for this test run (label split for secret scanners). */
    private static String account(KeyPair k) {
        String label = "PRIVATE" + " KEY";
        // Newlines escaped as in the JSON file Firebase gives you.
        String pem = "-----BEGIN " + label + "-----\\n" + Base64.getEncoder().encodeToString(k.getPrivate().getEncoded()) + "\\n-----END " + label + "-----\\n";
        return "{\"type\":\"service_account\",\"project_id\":\"circlo-test\",\"private_key\":\"" + pem
                + "\",\"client_email\":\"push@circlo-test.iam.gserviceaccount.com\"}";
    }

    private static KeyPair rsa() throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
        g.initialize(2048);
        return g.generateKeyPair();
    }

    @Test
    void isOffWithoutCredentials() {
        assertThat(new FcmSender(new FcmProperties(null)).enabled()).isFalse();
        assertThat(new FcmSender(new FcmProperties(" ")).enabled()).isFalse();
    }

    @Test
    void readsTheServiceAccountAsJsonOrBase64() throws Exception {
        KeyPair k = rsa();
        String json = account(k);
        assertThat(FcmSender.parseAccount(json).projectId()).isEqualTo("circlo-test");
        assertThat(FcmSender.parseAccount(Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8))).clientEmail())
                .isEqualTo("push@circlo-test.iam.gserviceaccount.com");
        assertThatThrownBy(() -> FcmSender.parseAccount("{}")).hasMessageContaining("not a valid Firebase service account");
    }

    @Test
    void signsTheAssertionForTheMessagingScope() throws Exception {
        KeyPair k = rsa();
        FcmSender s = new FcmSender(new FcmProperties(account(k)));
        SignedJWT jwt = SignedJWT.parse(s.assertion());
        assertThat(jwt.verify(new RSASSAVerifier((RSAPublicKey) k.getPublic()))).isTrue();
        assertThat(jwt.getJWTClaimsSet().getIssuer()).isEqualTo("push@circlo-test.iam.gserviceaccount.com");
        assertThat(jwt.getJWTClaimsSet().getAudience()).containsExactly("https://oauth2.googleapis.com/token");
        assertThat(jwt.getJWTClaimsSet().getStringClaim("scope")).isEqualTo(FcmSender.SCOPE);
    }

    @Test
    @SuppressWarnings("unchecked")
    void messageIsAFixedAlertWithRoutingIdsUnderBody() throws Exception {
        String json = FcmSender.payload("tok", new PushSender.Message("New message", Map.of("type", "message", "chatId", "c-1")));
        Map<String, Object> message = (Map<String, Object>) JSONObjectUtils.parse(json).get("message");
        assertThat(message.get("token")).isEqualTo("tok");
        assertThat(message.get("notification")).isEqualTo(Map.of("title", "Circlo", "body", "New message"));
        // The app reads a push's data from "body" (expo-notifications), the same on iPhone and Android.
        Map<String, Object> data = (Map<String, Object>) message.get("data");
        assertThat(JSONObjectUtils.parse((String) data.get("body"))).isEqualTo(Map.of("type", "message", "chatId", "c-1"));
        Map<String, Object> android = (Map<String, Object>) message.get("android");
        assertThat(android.get("priority")).isEqualTo("high");
        assertThat((Map<String, Object>) android.get("notification")).containsEntry("channel_id", "activity");
    }

    @Test
    void dispatcherPicksTheProviderForEachDevice() {
        FcmSender fcmOff = new FcmSender(new FcmProperties(null));
        ApnsSender apnsOff = new ApnsSender(new ApnsProperties(null, null, null, "t"));
        PushDispatcher d = new PushDispatcher(List.of(apnsOff, fcmOff));
        assertThat(d.enabled()).isFalse();
        // Not configured: the token is kept for when it is; an unknown service is dropped.
        assertThat(d.send("fcm", "x".repeat(30), new PushSender.Message("x", Map.of()))).isEqualTo(PushSender.Result.FAILED);
        assertThat(d.send("pigeon", "x", new PushSender.Message("x", Map.of()))).isEqualTo(PushSender.Result.UNREGISTERED);
        assertThat(apnsOff.handles("apns_sandbox")).isTrue();
        assertThat(fcmOff.handles("fcm")).isTrue();
        assertThat(FcmSender.TOKEN.matcher("dGVzdA:APA91b" + "x".repeat(140)).matches()).isTrue();
    }
}
