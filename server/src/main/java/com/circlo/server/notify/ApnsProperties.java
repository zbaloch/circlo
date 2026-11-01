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
