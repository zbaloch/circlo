package com.circlo.server.notify;

import com.circlo.server.config.ServerSecrets;
import com.circlo.server.web.Ids;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/**
 * Seals device push tokens at rest (AES-256-GCM, bound to the device row). The key is derived from CIRCLO_JWT_KEY, so
 * rotating that secret only means phones register their token again, which they do on every launch.
 */
@Component
public class PushTokens {

    private final SecretKeySpec key;

    public PushTokens(ServerSecrets secrets) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secrets.jwtKey(), "HmacSHA256"));
            key = new SecretKeySpec(mac.doFinal("circlo.push-token.v1".getBytes(StandardCharsets.UTF_8)), "AES");
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    public byte[] seal(byte[] deviceId, String token) {
        try {
            byte[] iv = Ids.random(12);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
            c.updateAAD(deviceId);
            byte[] ct = c.doFinal(token.getBytes(StandardCharsets.UTF_8));
            byte[] out = Arrays.copyOf(iv, iv.length + ct.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            return out;
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** The token, or null if it can't be opened (e.g. sealed under an earlier key). */
    public String open(byte[] deviceId, byte[] sealed) {
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, sealed, 0, 12));
            c.updateAAD(deviceId);
            return new String(c.doFinal(sealed, 12, sealed.length - 12), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            return null;
        }
    }
}
