package com.halqo.server.push;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Picks the push sender: FCM HTTP v1 when HALQO_FCM_PROJECT_ID and HALQO_FCM_SERVICE_ACCOUNT (the service-account JSON,
 * from the secret store) are set; otherwise pushes are skipped. APNs is added with the iOS build.
 */
@Configuration
public class PushConfig {

    @Bean
    PushSender pushSender(@Value("${halqo.push.fcm.project-id:}") String projectId,
            @Value("${halqo.push.fcm.service-account:}") String serviceAccountJson) {
        if (projectId.isBlank() || serviceAccountJson.isBlank()) {
            return (platform, token, data) -> {};
        }
        return new FcmPushSender(projectId, serviceAccountJson);
    }
}
