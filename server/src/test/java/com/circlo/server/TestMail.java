package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.circlo.server.mail.EmailSender;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/** Captures emails in tests instead of sending (or printing) them. */
@TestConfiguration
public class TestMail {

    public record Sent(String to, String subject, String body, Map<String, String> headers) {}

    private final List<Sent> sent = new ArrayList<>();

    @Bean
    @Primary
    EmailSender capturingEmailSender() {
        return (to, subject, body, headers) -> {
            synchronized (sent) {
                sent.add(new Sent(to, subject, body, headers));
            }
        };
    }

    public List<Sent> to(String email) {
        synchronized (sent) {
            return sent.stream().filter(s -> s.to().equals(email)).toList();
        }
    }

    /** The 6-digit code in the latest email to this address. */
    public String lastCode(String email) {
        List<Sent> mine = to(email);
        assertThat(mine).as("an email to " + email).isNotEmpty();
        Matcher m = Pattern.compile("\\b(\\d{6})\\b").matcher(mine.get(mine.size() - 1).body());
        assertThat(m.find()).isTrue();
        return m.group(1);
    }
}
