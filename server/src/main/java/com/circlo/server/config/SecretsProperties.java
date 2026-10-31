package com.circlo.server.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Server secrets under {@code circlo.secrets.*}, base64-encoded, from {@code CIRCLO_*} environment variables only. */
@ConfigurationProperties("circlo.secrets")
public record SecretsProperties(String jwtKey) {}
