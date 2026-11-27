package com.circlo.server.reading;

import com.circlo.server.config.ServerSecrets;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Optional;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Signed links to article images, so they're fetched by Circlo and the publisher never sees who reads. A link is
 * {@code /v1/reading/image?u=<address>&e=<expiry>&s=<signature>}, signed with a key derived from CIRCLO_JWT_KEY
 * ("circlo.reading-image.v1"). Only articles' own images are ever signed, and only for people who follow their
 * source, so the image endpoint isn't an open proxy. Links last two to three days and are the same all day, so
 * phones and browsers cache them.
 */
@Component
public class ReadingImages {

    private static final Duration LIFETIME = Duration.ofDays(3);
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private final SecretKeySpec key;

    @Autowired
    public ReadingImages(ServerSecrets secrets) {
        this(secrets.jwtKey());
    }

    ReadingImages(byte[] rootKey) {
        this.key = new SecretKeySpec(hmac(new SecretKeySpec(rootKey, "HmacSHA256"), "circlo.reading-image.v1"), "HmacSHA256");
    }

    private static byte[] hmac(SecretKeySpec k, String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(k);
            return mac.doFinal(data.getBytes(StandardCharsets.UTF_8));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The signed Circlo path for an image's address (relative: the app puts its API address in front). */
    public String path(String url, Instant now) {
        String u = B64.encodeToString(url.getBytes(StandardCharsets.UTF_8));
        long e = now.truncatedTo(ChronoUnit.DAYS).plus(LIFETIME).getEpochSecond();
        return "/v1/reading/image?u=" + u + "&e=" + e + "&s=" + B64.encodeToString(hmac(key, u + "." + e));
    }

    /** The image's address, if the link is Circlo's own and hasn't expired. */
    public Optional<String> verify(String u, String e, String s, Instant now) {
        if (u == null || e == null || s == null || u.length() > 4096) {
            return Optional.empty();
        }
        try {
            long expires = Long.parseLong(e);
            byte[] expected = hmac(key, u + "." + expires);
            byte[] given = Base64.getUrlDecoder().decode(s);
            if (!MessageDigest.isEqual(expected, given) || now.getEpochSecond() >= expires) {
                return Optional.empty();
            }
            return Optional.of(new String(Base64.getUrlDecoder().decode(u), StandardCharsets.UTF_8));
        } catch (IllegalArgumentException ex) {
            return Optional.empty();
        }
    }
}
