package com.circlo.server.auth;

import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * Argon2id password hashes (Spring Security's encoder: 16-byte salt, 32-byte hash, 16 MiB, 2 iterations). Passwords
 * are never stored or logged; a login for an unknown account is checked against a dummy hash so it takes as long.
 */
@Component
public class PasswordHasher {

    private final Argon2PasswordEncoder encoder = Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();
    private final String dummy = encoder.encode("circlo-dummy-password-for-timing");

    public String hash(String password) {
        return encoder.encode(password);
    }

    public boolean matches(String password, String hash) {
        return encoder.matches(password, hash);
    }

    /** Spends the same time as {@link #matches} for a login that has no account. */
    public void burn(String password) {
        encoder.matches(password, dummy);
    }
}
