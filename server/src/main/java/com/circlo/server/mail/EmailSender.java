package com.circlo.server.mail;

/** Sends a plain-text email. Implementations never log the recipient. */
public interface EmailSender {

    void send(String to, String subject, String body);
}
