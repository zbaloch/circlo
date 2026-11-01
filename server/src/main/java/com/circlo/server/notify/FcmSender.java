package com.circlo.server.notify;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.util.JSONObjectUtils;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.text.ParseException;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/**
 * Sends pushes straight to Google (FCM HTTP v1) for Android phones, signed with the Firebase project's service account;
 * no third-party push service in between. Same content-free message as on iPhone.
 */
@Component
public class FcmSender implements PushService {

    static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9_:.-]{20,400}");
    static final String SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
    private static final String TOKEN_URI = "https://oauth2.googleapis.com/token";

    record Account(String projectId, String clientEmail, PrivateKey key) {}

    private final Account account;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private String accessToken;
    private Instant accessUntil = Instant.EPOCH;

    public FcmSender(FcmProperties props) {
        this.account = props.configured() ? parseAccount(props.serviceAccount()) : null;
    }

    /** The service account JSON from the Firebase console, as JSON text or base64 of it (one line). */
    static Account parseAccount(String text) {
        try {
            String json = text.trim().startsWith("{") ? text : new String(Base64.getDecoder().decode(text.trim()), StandardCharsets.UTF_8);
            Map<String, Object> m = JSONObjectUtils.parse(json);
            String pem = (String) m.get("private_key");
            String body = pem.replaceAll("-----[A-Z ]+-----", "").replaceAll("\\s", "");
            PrivateKey key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(body)));
            String project = (String) m.get("project_id");
            String email = (String) m.get("client_email");
            if (project == null || email == null) {
                throw new IllegalArgumentException();
            }
            return new Account(project, email, key);
        } catch (ParseException | GeneralSecurityException | RuntimeException e) {
            throw new IllegalStateException("CIRCLO_FCM_SERVICE_ACCOUNT is not a valid Firebase service account JSON");
        }
    }

    @Override
    public boolean handles(String service) {
        return "fcm".equals(service);
    }

    @Override
    public boolean enabled() {
        return account != null;
    }

    /** The signed assertion exchanged for an access token (valid one hour). */
    String assertion() {
        Instant now = Instant.now();
        try {
            SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).build(), new JWTClaimsSet.Builder()
                    .issuer(account.clientEmail()).audience(TOKEN_URI).claim("scope", SCOPE)
                    .issueTime(Date.from(now)).expirationTime(Date.from(now.plusSeconds(3600))).build());
            jwt.sign(new RSASSASigner(account.key()));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException("couldn't sign the FCM assertion");
        }
    }

    private synchronized String accessToken() throws IOException, InterruptedException {
        if (accessToken == null || Instant.now().isAfter(accessUntil)) {
            String form = "grant_type=" + URLEncoder.encode("urn:ietf:params:oauth:grant-type:jwt-bearer", StandardCharsets.UTF_8)
                    + "&assertion=" + URLEncoder.encode(assertion(), StandardCharsets.UTF_8);
            HttpResponse<String> res = http.send(HttpRequest.newBuilder(URI.create(TOKEN_URI)).timeout(Duration.ofSeconds(15))
                    .header("content-type", "application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(form)).build(),
                    HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) {
                throw new IOException("token exchange failed");
            }
            try {
                Map<String, Object> m = JSONObjectUtils.parse(res.body());
                accessToken = (String) m.get("access_token");
                long ttl = ((Number) m.getOrDefault("expires_in", 3600)).longValue();
                accessUntil = Instant.now().plusSeconds(Math.max(60, ttl - 300));
            } catch (ParseException e) {
                throw new IOException("token exchange failed");
            }
        }
        return accessToken;
    }

    /**
     * The FCM message: a fixed title and alert shown by Android, high priority so it arrives at once, on the app's
     * "activity" channel, and the routing ids as a JSON string under "body" (where expo-notifications reads a push's
     * data on both platforms).
     */
    static String payload(String token, PushSender.Message m) {
        String type = m.data().getOrDefault("type", "circlo");
        return "{\"message\":{\"token\":" + ApnsSender.quote(token)
                + ",\"notification\":{\"title\":\"Circlo\",\"body\":" + ApnsSender.quote(m.alert()) + "}"
                + ",\"data\":{\"body\":" + ApnsSender.quote(ApnsSender.object(m.data())) + "}"
                + ",\"android\":{\"priority\":\"high\",\"notification\":{\"channel_id\":\"activity\",\"tag\":" + ApnsSender.quote(type)
                + ",\"default_sound\":true}}}}";
    }

    @Override
    public PushSender.Result send(String service, String token, PushSender.Message m) {
        if (!enabled() || !TOKEN.matcher(token).matches()) {
            return PushSender.Result.UNREGISTERED;
        }
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create("https://fcm.googleapis.com/v1/projects/" + account.projectId() + "/messages:send"))
                    .timeout(Duration.ofSeconds(15))
                    .header("authorization", "Bearer " + accessToken())
                    .header("content-type", "application/json; charset=UTF-8")
                    .POST(HttpRequest.BodyPublishers.ofString(payload(token, m)))
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 200) {
                return PushSender.Result.SENT;
            }
            if (res.statusCode() == 404 || res.body().contains("UNREGISTERED")
                    || (res.statusCode() == 400 && res.body().contains("registration token"))) {
                return PushSender.Result.UNREGISTERED;
            }
            if (res.statusCode() == 401) {
                synchronized (this) {
                    accessToken = null;
                }
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
