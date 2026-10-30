package com.circlo.server.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Server secrets under {@code circlo.secrets.*}, base64-encoded, from {@code CIRCLO_*} environment variables only.
 * They live outside the database (CRYPTO.md section 13) and none of them can decrypt user content.
 */
@ConfigurationProperties("circlo.secrets")
public record SecretsProperties(String opaqueServerSetup, String handleKey, String jwtKey) {}
