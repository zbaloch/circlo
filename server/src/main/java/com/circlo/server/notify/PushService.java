package com.circlo.server.notify;

/** One push provider (Apple or Google). {@link PushDispatcher} picks the one for a device's service. */
public interface PushService {

    /** Whether this provider delivers to devices registered with `service` (apns, apns_sandbox, fcm). */
    boolean handles(String service);

    /** False when its credentials aren't configured. */
    boolean enabled();

    PushSender.Result send(String service, String token, PushSender.Message message);
}
