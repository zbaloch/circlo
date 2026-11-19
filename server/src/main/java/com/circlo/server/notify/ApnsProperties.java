package com.circlo.server.notify;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Apple Push Notification service credentials under {@code circlo.apns.*} (CIRCLO_APNS_*). Push is off unless all of
 * key, key id and team id are set.
 *
 * @param key    the .p8 auth key from developer.apple.com: its PEM text, or the whole file base64-encoded (one line)
 * @param keyId  the key's 10-character id
 * @param teamId the Apple developer team id
 * @param topic  the app's bundle id
 */
@ConfigurationProperties("circlo.apns")
public record ApnsProperties(String key, String keyId, String teamId, String topic) {

    /** Values pasted into an env file often bring a stray space, Windows line ending or quotes; Apple refuses those. */
    public ApnsProperties {
        key = clean(key);
        keyId = clean(keyId);
        teamId = clean(teamId);
        topic = clean(topic);
    }

    static String clean(String s) {
        if (s == null) {
            return null;
        }
        String t = s.strip();
        if (t.length() >= 2 && (t.startsWith("\"") && t.endsWith("\"") || t.startsWith("'") && t.endsWith("'"))) {
            t = t.substring(1, t.length() - 1).strip();
        }
        return t;
    }

    public boolean configured() {
        return notBlank(key) && notBlank(keyId) && notBlank(teamId) && notBlank(topic);
    }

    private static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }

    @Override
    public String toString() {
        return "ApnsProperties[redacted]";
    }
}
