package com.halqo.server.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Server secrets under {@code halqo.secrets.*}, base64-encoded, from {@code HALQO_*} environment variables only.
 * They live outside the database (CRYPTO.md section 13) and none of them can decrypt user content.
 */
@ConfigurationProperties("halqo.secrets")
public record SecretsProperties(String opaqueServerSetup, String handleKey, String pushTokenKey, String jwtKey) {}
