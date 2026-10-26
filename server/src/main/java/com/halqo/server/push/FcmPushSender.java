package com.halqo.server.push;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * FCM HTTP v1 sender using a service account (JWT bearer grant, RS256 signed with the JDK). Sends data-only messages
 * ({@code {"type":"activity"}}) with high priority so the app can wake, fetch and decrypt.
 */
final class FcmPushSender implements PushSender {

    private static final String SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

    private final ObjectMapper json = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final String projectId;
    private final String clientEmail;
    private final String tokenUri;
    private final PrivateKey key;
    private String accessToken;
    private Instant accessTokenExpiry = Instant.EPOCH;

    FcmPushSender(String projectId, String serviceAccountJson) {
        this.projectId = projectId;
        JsonNode sa = json.readTree(serviceAccountJson);
        this.clientEmail = sa.path("client_email").asString();
        this.tokenUri = sa.path("token_uri").asString("https://oauth2.googleapis.com/token");
        String pem = sa.path("private_key").asString().replaceAll("-----[A-Z ]+-----", "").replaceAll("\\s", "");
        try {
            this.key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(pem)));
        } catch (Exception e) {
            throw new IllegalStateException("HALQO_FCM_SERVICE_ACCOUNT has no usable private key");
        }
    }

    private static String b64url(byte[] b) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    private synchronized String accessToken() throws Exception {
        if (accessToken != null && Instant.now().isBefore(accessTokenExpiry.minusSeconds(60))) {
            return accessToken;
        }
        long now = Instant.now().getEpochSecond();
        String header = b64url("{\"alg\":\"RS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
        String claims = b64url(json.writeValueAsBytes(Map.of("iss", clientEmail, "scope", SCOPE, "aud", tokenUri, "iat", now, "exp", now + 3600)));
        Signature sig = Signature.getInstance("SHA256withRSA");
        sig.initSign(key);
        sig.update((header + "." + claims).getBytes(StandardCharsets.US_ASCII));
        String assertion = header + "." + claims + "." + b64url(sig.sign());
        String form = "grant_type=" + URLEncoder.encode("urn:ietf:params:oauth:grant-type:jwt-bearer", StandardCharsets.UTF_8)
                + "&assertion=" + URLEncoder.encode(assertion, StandardCharsets.UTF_8);
        HttpResponse<String> res = http.send(HttpRequest.newBuilder(URI.create(tokenUri)).timeout(Duration.ofSeconds(10))
                .header("Content-Type", "application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(form)).build(),
                HttpResponse.BodyHandlers.ofString());
        JsonNode body = json.readTree(res.body());
        accessToken = body.path("access_token").asString();
        accessTokenExpiry = Instant.now().plusSeconds(body.path("expires_in").asLong(3600));
        return accessToken;
    }

    @Override
    public void send(String platform, byte[] token, Map<String, String> data) {
        if (!"android".equals(platform)) {
            return; // iOS goes through APNs (added with the iOS build)
        }
        try {
            byte[] message = json.writeValueAsBytes(Map.of("message", Map.of(
                    "token", new String(token, StandardCharsets.UTF_8),
                    "data", data,
                    "android", Map.of("priority", "high"))));
            http.send(HttpRequest.newBuilder(URI.create("https://fcm.googleapis.com/v1/projects/" + projectId + "/messages:send"))
                    .timeout(Duration.ofSeconds(10)).header("Authorization", "Bearer " + accessToken())
                    .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofByteArray(message)).build(),
                    HttpResponse.BodyHandlers.discarding());
        } catch (Exception e) {
            // provider unreachable or token rejected: the app still syncs when opened
        }
    }
}
