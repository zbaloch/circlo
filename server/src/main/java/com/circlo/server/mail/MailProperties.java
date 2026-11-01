package com.circlo.server.mail;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Email settings under {@code circlo.mail.*}. {@code mode} is {@code smtp} (the default: the SMTP server in
 * {@code spring.mail.*}, from CIRCLO_MAIL_* variables) or {@code log}, which only prints messages to the server console
 * and is meant for local development.
 */
@ConfigurationProperties("circlo.mail")
public record MailProperties(String mode, String from) {

    public MailProperties {
        mode = mode == null || mode.isBlank() ? "smtp" : mode;
        from = from == null || from.isBlank() ? "Circlo <no-reply@hellocirclo.com>" : from;
    }
}
