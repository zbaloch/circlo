package com.circlo.server.reading;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Reading, under {@code circlo.reading.*}.
 *
 * @param scheduled         whether feeds are checked on their own (tests call ReadingRefresher themselves)
 * @param allowPrivateHosts fetch from loopback and private addresses: only for tests, which serve feeds locally
 * @param checkEvery        how often each feed is checked
 */
@ConfigurationProperties("circlo.reading")
public record ReadingProperties(Boolean scheduled, Boolean allowPrivateHosts, Duration checkEvery) {

    public ReadingProperties {
        scheduled = scheduled == null || scheduled;
        allowPrivateHosts = allowPrivateHosts != null && allowPrivateHosts;
        checkEvery = checkEvery == null ? Duration.ofMinutes(30) : checkEvery;
    }
}
