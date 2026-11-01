package com.circlo.server.notify;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Notifications, under {@code circlo.notify.*}.
 *
 * @param dailyScheduled whether the daily notifications go out on their own (tests send them by hand)
 * @param webBase        the web app's address, linked from the emails (CIRCLO_WEB_BASE)
 * @param apiBase        this server's public address, for the unsubscribe link (CIRCLO_API_BASE)
 */
@ConfigurationProperties("circlo.notify")
public record NotifyProperties(Boolean dailyScheduled, String webBase, String apiBase) {

    public NotifyProperties {
        dailyScheduled = dailyScheduled == null || dailyScheduled;
        webBase = trim(webBase, "https://app.hellocirclo.com");
        apiBase = trim(apiBase, "https://api.hellocirclo.com");
    }

    private static String trim(String url, String fallback) {
        String u = url == null || url.isBlank() ? fallback : url.strip();
        return u.endsWith("/") ? u.substring(0, u.length() - 1) : u;
    }
}
