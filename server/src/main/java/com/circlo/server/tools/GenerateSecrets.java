package com.circlo.server.tools;

import java.security.SecureRandom;
import java.util.Base64;

/**
 * Prints a fresh set of server secrets as {@code CIRCLO_*=...} lines for a git-ignored env file or a secret store.
 * Run from server/: {@code mvn -q compile exec:java -Dexec.mainClass=com.circlo.server.tools.GenerateSecrets}.
 * Never commit the output.
 */
public final class GenerateSecrets {

    private GenerateSecrets() {}

    public static void main(String[] args) {
        byte[] key = new byte[32];
        new SecureRandom().nextBytes(key);
        System.out.println("CIRCLO_JWT_KEY=" + Base64.getEncoder().encodeToString(key));
    }
}
