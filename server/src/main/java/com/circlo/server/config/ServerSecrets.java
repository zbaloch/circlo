package com.circlo.server.config;

import java.util.Base64;
import org.springframework.stereotype.Component;

/** Decoded, validated server secrets. The server refuses to start if any is missing or malformed. */
@Component
public class ServerSecrets {

    private final byte[] opaqueServerSetup;
    private final byte[] handleKey;
    private final byte[] jwtKey;

    public ServerSecrets(SecretsProperties props) {
        this.opaqueServerSetup = decode("CIRCLO_OPAQUE_SERVER_SETUP", props.opaqueServerSetup(), 64);
        this.handleKey = exact("CIRCLO_HANDLE_KEY", decode("CIRCLO_HANDLE_KEY", props.handleKey(), 32), 32);
        this.jwtKey = decode("CIRCLO_JWT_KEY", props.jwtKey(), 32);
    }

    private static byte[] decode(String name, String value, int minLength) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is not set (generate secrets with GenerateSecrets; see DEV_SETUP.md)");
        }
        byte[] b;
        try {
            b = Base64.getDecoder().decode(value.trim());
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(name + " is not valid base64");
        }
        if (b.length < minLength) {
            throw new IllegalStateException(name + " is too short");
        }
        return b;
    }

    private static byte[] exact(String name, byte[] b, int length) {
        if (b.length != length) {
            throw new IllegalStateException(name + " must be exactly " + length + " bytes");
        }
        return b;
    }

    public byte[] opaqueServerSetup() {
        return opaqueServerSetup.clone();
    }

    public byte[] handleKey() {
        return handleKey.clone();
    }

    public byte[] jwtKey() {
        return jwtKey.clone();
    }

    @Override
    public String toString() {
        return "ServerSecrets[redacted]";
    }
}
