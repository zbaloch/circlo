package com.circlo.server;

import com.circlo.server.notify.PushSender;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/** Captures pushes in tests instead of sending them to Apple. A token starting with "bad" is answered as unregistered. */
@TestConfiguration
public class TestPush {

    public record Sent(String service, String token, String alert, Map<String, String> data) {}

    private final List<Sent> sent = new ArrayList<>();

    @Bean
    @Primary
    PushSender capturingPushSender() {
        return new PushSender() {
            @Override
            public boolean enabled() {
                return true;
            }

            @Override
            public Result send(String service, String token, PushSender.Message m) {
                synchronized (sent) {
                    sent.add(new Sent(service, token, m.alert(), m.data()));
                }
                return token.startsWith("bad") ? Result.UNREGISTERED : Result.SENT;
            }
        };
    }

    public List<Sent> to(String token) {
        synchronized (sent) {
            return sent.stream().filter(s -> s.token().equals(token)).toList();
        }
    }

    /** Waits up to 3 s for `n` pushes to this token (they are sent after the request's transaction commits). */
    public List<Sent> await(String token, int n) throws InterruptedException {
        for (int i = 0; i < 60 && to(token).size() < n; i++) {
            Thread.sleep(50);
        }
        return to(token);
    }
}
