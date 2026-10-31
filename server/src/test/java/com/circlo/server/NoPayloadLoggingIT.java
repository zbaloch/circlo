package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

/** Logs during real traffic contain no names, usernames, emails, passwords, codes, tokens, content or IPs. */
@ExtendWith(OutputCaptureExtension.class)
class NoPayloadLoggingIT extends IntegrationTest {

    @Test
    void trafficLeavesNothingPersonalInTheLogs(CapturedOutput output) {
        TestUser a = new TestUser(this, "Distinctive Logname", "logcheck_user", "logcheck@example.test", "a distinctive passphrase").signUp();
        TestUser b = user("logcheck_friend");
        a.befriend(b);
        a.login("logcheck_user", "a distinctive passphrase");
        a.login("logcheck_nobody", "another distinctive guess");
        a.post("a distinctive post body", "everyone", List.of());
        call("POST", "/v1/auth/password/forgot", Map.of("email", a.email), null);
        String code = mail.lastCode(a.email);

        assertThat(output.getAll())
                .doesNotContain("Distinctive Logname")
                .doesNotContainIgnoringCase("logcheck_user")
                .doesNotContainIgnoringCase("logcheck_nobody")
                .doesNotContain("logcheck@example.test")
                .doesNotContain("a distinctive passphrase")
                .doesNotContain("another distinctive guess")
                .doesNotContain("a distinctive post body")
                .doesNotContain(code)
                .doesNotContain(a.accessToken)
                .doesNotContain(a.refreshToken)
                .doesNotContain(a.userId.toString())
                .doesNotContain("127.0.0.1")
                .doesNotContain("0:0:0:0:0:0:0:1")
                .doesNotContain("jdbc:");
    }
}
