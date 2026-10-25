package com.halqo.server.crypto;

/**
 * Thrown by the native core. The message is only an error kind (for example {@code AuthFailed}); it never contains
 * key material, ciphertext or plaintext.
 */
public class CoreException extends RuntimeException {

    public CoreException(String kind) {
        super(kind);
    }

    public String kind() {
        return getMessage();
    }
}
