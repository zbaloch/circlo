package com.circlo.server.notify;

import java.util.List;
import org.springframework.stereotype.Component;

/** Sends each push through the provider for the device's service: APNs for iPhones, FCM for Android phones. */
@Component
public class PushDispatcher implements PushSender {

    private final List<PushService> services;

    public PushDispatcher(List<PushService> services) {
        this.services = List.copyOf(services);
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
