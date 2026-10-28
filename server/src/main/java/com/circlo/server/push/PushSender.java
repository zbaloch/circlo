package com.circlo.server.push;

import java.util.Map;

/** Delivers one push. Payloads are always content-free ({@code {"type": "activity"}}); the app fetches and decrypts. */
@FunctionalInterface
public interface PushSender {

    void send(String platform, byte[] token, Map<String, String> data);
}
