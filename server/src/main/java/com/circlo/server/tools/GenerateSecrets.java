package com.circlo.server.tools;

import com.circlo.server.crypto.CircloCore;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * Prints a fresh set of server secrets as {@code CIRCLO_*=...} lines for a git-ignored env file or a secret store.
 * Run from server/: {@code mvn -q compile exec:java -Dexec.mainClass=com.circlo.server.tools.GenerateSecrets}
 * (needs the native core built). Never commit the output.
 */
public final class GenerateSecrets {

    private GenerateSecrets() {}

    public static void main(String[] args) {
        CircloCore core = new CircloCore(System.getenv().getOrDefault("CIRCLO_CORE_LIBRARY", ""));
        Base64.Encoder b64 = Base64.getEncoder();
        SecureRandom random = new SecureRandom();
        System.out.println("CIRCLO_OPAQUE_SERVER_SETUP=" + b64.encodeToString(core.opaqueServerSetupNew()));
        for (String name : new String[] {"CIRCLO_HANDLE_KEY", "CIRCLO_JWT_KEY"}) {
            byte[] key = new byte[32];
            random.nextBytes(key);
            System.out.println(name + "=" + b64.encodeToString(key));
        }
    }
}
