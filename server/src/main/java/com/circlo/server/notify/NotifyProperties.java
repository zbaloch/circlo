package com.circlo.server.notify;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Notification emails, under {@code circlo.notify.*}.
 *
 * @param emailDelay how long after the first waiting notification its email goes out, gathering what follows into it
 * @param webBase    the web app's address, linked from the email (CIRCLO_WEB_BASE)
 * @param apiBase    this server's public address, for the unsubscribe link (CIRCLO_API_BASE)
 */
@ConfigurationProperties("circlo.notify")
public record NotifyProperties(Duration emailDelay, String webBase, String apiBase) {

    public NotifyProperties {
        emailDelay = emailDelay == null ? Duration.ofMinutes(15) : emailDelay;
        webBase = trim(webBase, "https://app.hellocirclo.com");
        apiBase = trim(apiBase, "https://api.hellocirclo.com");
    }

    private static String trim(String url, String fallback) {
        String u = url == null || url.isBlank() ? fallback : url.strip();
        return u.endsWith("/") ? u.substring(0, u.length() - 1) : u;
    }
}
