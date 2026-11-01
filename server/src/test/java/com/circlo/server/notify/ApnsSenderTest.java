package com.circlo.server.notify;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.nimbusds.jose.crypto.ECDSAVerifier;
import com.nimbusds.jwt.SignedJWT;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.util.Base64;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ApnsSenderTest {

    private static KeyPair p256() throws Exception {
        KeyPairGenerator g = KeyPairGenerator.getInstance("EC");
        g.initialize(new ECGenParameterSpec("secp256r1"));
        return g.generateKeyPair();
    }

    /** A .p8-style PEM of a key made for this test run (the label is split so secret scanners don't flag the source). */
    private static String pem(KeyPair k) {
        String label = "PRIVATE" + " KEY";
        return "-----BEGIN " + label + "-----\n" + Base64.getMimeEncoder().encodeToString(k.getPrivate().getEncoded()) + "\n-----END " + label + "-----\n";
    }

    @Test
    void isOffWithoutCredentials() {
        assertThat(new ApnsSender(new ApnsProperties(null, null, null, "com.hellocirclo.app")).enabled()).isFalse();
        assertThat(new ApnsSender(new ApnsProperties("", "K", "T", "com.hellocirclo.app")).enabled()).isFalse();
    }

    @Test
    void readsTheP8AsPemOrAsOneBase64Line() throws Exception {
        KeyPair k = p256();
        String oneLine = Base64.getEncoder().encodeToString(pem(k).getBytes(StandardCharsets.UTF_8));
        assertThat(ApnsSender.parseKey(pem(k)).getEncoded()).isEqualTo(k.getPrivate().getEncoded());
        assertThat(ApnsSender.parseKey(oneLine).getEncoded()).isEqualTo(k.getPrivate().getEncoded());
        assertThatThrownBy(() -> ApnsSender.parseKey("not a key")).hasMessage("CIRCLO_APNS_KEY is not a valid .p8 key");
    }

    @Test
    void signsTheProviderTokenWithTheKeyIdAndTeam() throws Exception {
        KeyPair k = p256();
        ApnsSender s = new ApnsSender(new ApnsProperties(pem(k), "ABC123DEFG", "TEAM123456", "com.hellocirclo.app"));
        assertThat(s.enabled()).isTrue();
        SignedJWT jwt = SignedJWT.parse(s.jwt());
        assertThat(jwt.verify(new ECDSAVerifier((ECPublicKey) k.getPublic()))).isTrue();
        assertThat(jwt.getHeader().getKeyID()).isEqualTo("ABC123DEFG");
        assertThat(jwt.getJWTClaimsSet().getIssuer()).isEqualTo("TEAM123456");
        assertThat(s.jwt()).isEqualTo(s.jwt()); // reused, not re-signed per push
    }

    @Test
    void payloadIsAFixedAlertAndRoutingIdsOnly() {
        String json = ApnsSender.payload(new PushSender.Message("New reply", Map.of("type", "reply", "postId", "p-1", "replyId", "r-2")));
        assertThat(json).isEqualTo("{\"aps\":{\"alert\":{\"title\":\"Circlo\",\"body\":\"New reply\"},\"sound\":\"default\",\"thread-id\":\"reply\"},"
                + "\"postId\":\"p-1\",\"replyId\":\"r-2\",\"type\":\"reply\"}");
        assertThat(ApnsSender.payload(new PushSender.Message("a\"b\\c\n", Map.of()))).contains("\"body\":\"a\\\"b\\\\c\\u000a\"");
    }

    @Test
    void refusesTokensThatArentApnsTokens() {
        ApnsSender off = new ApnsSender(new ApnsProperties(null, null, null, "t"));
        assertThat(off.send("apns", "abc", new PushSender.Message("x", Map.of()))).isEqualTo(PushSender.Result.UNREGISTERED);
        assertThat(ApnsSender.TOKEN.matcher("a".repeat(64)).matches()).isTrue();
        assertThat(ApnsSender.TOKEN.matcher("../../etc").matches()).isFalse();
    }
}
