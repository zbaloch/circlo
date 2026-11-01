package com.circlo.server.notify;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Firebase Cloud Messaging credentials under {@code circlo.fcm.*} (CIRCLO_FCM_*). Push to Android is off unless set.
 *
 * @param serviceAccount the Firebase project's service account key (Project settings → Service accounts → Generate new
 *                       private key): its JSON, or the whole file base64-encoded on one line
 */
@ConfigurationProperties("circlo.fcm")
public record FcmProperties(String serviceAccount) {

    public boolean configured() {
        return serviceAccount != null && !serviceAccount.isBlank();
    }

    @Override
    public String toString() {
        return "FcmProperties[redacted]";
    }
}
