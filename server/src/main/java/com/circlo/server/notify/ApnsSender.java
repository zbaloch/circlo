package com.circlo.server.notify;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.interfaces.ECPrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * Sends pushes straight to Apple (HTTP/2, token auth with the .p8 key); no third-party push service in between.
 * TestFlight and App Store builds use the production service (apns), development builds the sandbox (apns_sandbox).
 */
@Component
public class ApnsSender implements PushService {

    static final Pattern TOKEN = Pattern.compile("[0-9a-fA-F]{32,200}");
    private static final Duration JWT_TTL = Duration.ofMinutes(40);

    private final ApnsProperties props;
    private final ECPrivateKey key;
    private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_2).connectTimeout(Duration.ofSeconds(10)).build();
    private String jwt;
    private Instant jwtAt = Instant.EPOCH;

    public ApnsSender(ApnsProperties props) {
        this.props = props;
        this.key = props.configured() ? parseKey(props.key()) : null;
    }

    static ECPrivateKey parseKey(String text) {
        try {
            String pem = text.contains("BEGIN") ? text : new String(Base64.getDecoder().decode(text.trim()), StandardCharsets.UTF_8);
            String body = pem.replaceAll("-----[A-Z ]+-----", "").replaceAll("\\s", "");
            return (ECPrivateKey) KeyFactory.getInstance("EC").generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(body)));
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new IllegalStateException("CIRCLO_APNS_KEY is not a valid .p8 key");
        }
    }

    @Override
    public boolean handles(String service) {
        return "apns".equals(service) || "apns_sandbox".equals(service);
    }

    @Override
    public boolean enabled() {
        return key != null;
    }

    /** The provider token, renewed every 40 minutes (Apple accepts up to 60 and refuses renewals more often than 20). */
    synchronized String jwt() {
        if (jwt == null || Instant.now().isAfter(jwtAt.plus(JWT_TTL))) {
            try {
                SignedJWT signed = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.ES256).keyID(props.keyId()).build(),
                        new JWTClaimsSet.Builder().issuer(props.teamId()).issueTime(new Date()).build());
                signed.sign(new ECDSASigner(key));
                jwt = signed.serialize();
                jwtAt = Instant.now();
            } catch (JOSEException e) {
                throw new IllegalStateException("couldn't sign the APNs token");
            }
        }
        return jwt;
    }

    /**
     * The JSON body: a fixed alert, the default sound, and the routing ids under "body" (where expo-notifications hands
     * a remote push's data to the app on both platforms).
     */
    static String payload(PushSender.Message m) {
        return "{\"aps\":{\"alert\":{\"title\":\"Circlo\",\"body\":" + quote(m.alert()) + "},\"sound\":\"default\",\"thread-id\":"
                + quote(m.data().getOrDefault("type", "circlo")) + "},\"body\":" + object(m.data()) + "}";
    }

    /** A flat JSON object of strings, keys sorted. */
    static String object(Map<String, String> data) {
        StringBuilder b = new StringBuilder("{");
        for (Map.Entry<String, String> e : new TreeMap<>(data).entrySet()) {
            if (b.length() > 1) {
                b.append(',');
            }
            b.append(quote(e.getKey())).append(':').append(quote(e.getValue()));
        }
        return b.append('}').toString();
    }

    static String quote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') {
                b.append('\\').append(c);
            } else if (c < 0x20) {
                b.append(String.format("\\u%04x", (int) c));
            } else {
                b.append(c);
            }
        }
        return b.append('"').toString();
    }

    @Override
    public PushSender.Result send(String service, String token, PushSender.Message m) {
        if (!enabled() || !TOKEN.matcher(token).matches()) {
            return PushSender.Result.UNREGISTERED;
        }
        String host = "apns_sandbox".equals(service) ? "api.sandbox.push.apple.com" : "api.push.apple.com";
        HttpRequest req = HttpRequest.newBuilder(URI.create("https://" + host + "/3/device/" + token))
                .timeout(Duration.ofSeconds(15))
                .header("authorization", "bearer " + jwt())
                .header("apns-topic", props.topic())
                .header("apns-push-type", "alert")
                .header("apns-priority", "10")
                .POST(HttpRequest.BodyPublishers.ofString(payload(m)))
                .build();
        try {
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 200) {
                return PushSender.Result.SENT;
            }
            if (res.statusCode() == 410 || res.body().contains("BadDeviceToken") || res.body().contains("DeviceTokenNotForTopic")) {
                return PushSender.Result.UNREGISTERED;
            }
            return PushSender.Result.FAILED;
        } catch (IOException e) {
            return PushSender.Result.FAILED;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return PushSender.Result.FAILED;
        }
    }
}
