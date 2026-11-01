package com.circlo.server.notify;

import java.util.Map;

/**
 * Delivers one push to one device. Pushes are content-free: a fixed alert ("New reply") and random ids so the app can
 * open the right screen. Never names, text or counts.
 */
public interface PushSender {

    enum Result { SENT, UNREGISTERED, FAILED }

    record Message(String alert, Map<String, String> data) {}

    /** False when no credentials are configured; nothing is sent then. */
    boolean enabled();

    /** `service`: apns or apns_sandbox. */
    Result send(String service, String token, Message message);
}
