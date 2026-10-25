package com.halqo.server.tools;

import com.halqo.server.crypto.HalqoCore;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * Prints a fresh set of server secrets as {@code HALQO_*=...} lines for a git-ignored env file or a secret store.
 * Run from server/: {@code mvn -q compile exec:java -Dexec.mainClass=com.halqo.server.tools.GenerateSecrets}
 * (needs the native core built). Never commit the output.
 */
public final class GenerateSecrets {

    private GenerateSecrets() {}

    public static void main(String[] args) {
        HalqoCore core = new HalqoCore(System.getenv().getOrDefault("HALQO_CORE_LIBRARY", ""));
        Base64.Encoder b64 = Base64.getEncoder();
        SecureRandom random = new SecureRandom();
        System.out.println("HALQO_OPAQUE_SERVER_SETUP=" + b64.encodeToString(core.opaqueServerSetupNew()));
        for (String name : new String[] {"HALQO_HANDLE_KEY", "HALQO_PUSH_TOKEN_KEY", "HALQO_JWT_KEY"}) {
            byte[] key = new byte[32];
            random.nextBytes(key);
            System.out.println(name + "=" + b64.encodeToString(key));
        }
    }
}
