package com.halqo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

/** Phase 3 criterion: logs during real auth traffic contain no request payloads, handles, tokens or IPs. */
@ExtendWith(OutputCaptureExtension.class)
class NoPayloadLoggingIT extends IntegrationTest {

    @Test
    void authTrafficLeavesNothingSensitiveInTheLogs(CapturedOutput output) {
        TestApp a = new TestApp(this, "logcheck_user", "a distinctive passphrase").register();
        a.login("a distinctive passphrase");
        call("POST", "/v1/auth/login/start", java.util.Map.of("handle", "logcheck_nobody", "credentialRequest", new byte[] {1, 2}), null);
        call("GET", "/v1/backups/password", null, a.accessToken);

        String logs = output.getAll();
        assertThat(logs)
                .doesNotContainIgnoringCase("logcheck_user")
                .doesNotContainIgnoringCase("logcheck_nobody")
                .doesNotContain("a distinctive passphrase")
                .doesNotContain(a.accessToken)
                .doesNotContain(a.refreshToken)
                .doesNotContain(Base64.getEncoder().encodeToString(a.ed25519Pub()))
                .doesNotContain(a.userId.toString())
                .doesNotContain("127.0.0.1")
                .doesNotContain("0:0:0:0:0:0:0:1");
    }
}
