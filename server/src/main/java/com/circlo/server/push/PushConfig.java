package com.circlo.server.push;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Picks the push sender: FCM HTTP v1 when CIRCLO_FCM_PROJECT_ID and CIRCLO_FCM_SERVICE_ACCOUNT (the service-account JSON,
 * from the secret store) are set; otherwise pushes are skipped. APNs is added with the iOS build.
 */
@Configuration
public class PushConfig {

    @Bean
    PushSender pushSender(@Value("${circlo.push.fcm.project-id:}") String projectId,
            @Value("${circlo.push.fcm.service-account:}") String serviceAccountJson) {
        if (projectId.isBlank() || serviceAccountJson.isBlank()) {
            return (platform, token, data) -> {};
        }
        return new FcmPushSender(projectId, serviceAccountJson);
    }
}
