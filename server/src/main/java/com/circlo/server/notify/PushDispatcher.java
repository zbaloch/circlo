package com.circlo.server.notify;

import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** Sends each push through the provider for the device's service: APNs for iPhones, FCM for Android phones. */
@Component
public class PushDispatcher implements PushSender {

    private static final Logger log = LoggerFactory.getLogger(PushDispatcher.class);

    private final List<PushService> services;

    public PushDispatcher(List<PushService> services) {
        this.services = List.copyOf(services);
        // Which providers can deliver, so a missing credential shows at startup (no tokens or keys are logged).
        log.info("Push: iPhone (APNs) {}, Android (FCM) {}", status("apns"), status("fcm"));
    }

    private String status(String service) {
        return services.stream().filter(s -> s.handles(service)).findFirst().map(s -> s.enabled() ? "on" : "OFF (credentials not set)")
                .orElse("missing");
    }

    @Override
    public boolean enabled() {
        return services.stream().anyMatch(PushService::enabled);
    }

    @Override
    public Result send(String service, String token, Message message) {
        for (PushService s : services) {
            if (s.handles(service)) {
                // A provider without credentials keeps the token: it works again once they're configured.
                return s.enabled() ? s.send(service, token, message) : Result.FAILED;
            }
        }
        return Result.UNREGISTERED;
    }
}
