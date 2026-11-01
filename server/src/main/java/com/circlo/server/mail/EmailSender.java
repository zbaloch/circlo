package com.circlo.server.mail;

import java.util.Map;

/** Sends a plain-text email. Implementations never log the recipient. */
public interface EmailSender {

    default void send(String to, String subject, String body) {
        send(to, subject, body, Map.of());
    }

    /** With extra headers, e.g. List-Unsubscribe on notification emails. */
    void send(String to, String subject, String body, Map<String, String> headers);
}
