package com.circlo.server.mail;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;

@Configuration
public class MailConfig {

    private static final Logger log = LoggerFactory.getLogger(MailConfig.class);

    @Bean
    EmailSender emailSender(MailProperties props, ObjectProvider<JavaMailSender> smtp,
            @Value("${spring.mail.host:}") String host) {
        if (props.mode().equals("log")) {
            log.warn("circlo.mail.mode=log: emails are printed to this console instead of being sent (local development only)");
            // The body only (it holds the code a developer needs); never the recipient.
            return (to, subject, body) -> log.info("[dev mail] {}\n{}", subject, body);
        }
        JavaMailSender sender = smtp.getIfAvailable();
        if (sender == null || host.isBlank()) {
            throw new IllegalStateException("CIRCLO_MAIL_HOST is not set (or set CIRCLO_MAIL_MODE=log for local development)");
        }
        return (to, subject, body) -> {
            SimpleMailMessage m = new SimpleMailMessage();
            m.setFrom(props.from());
            m.setTo(to);
            m.setSubject(subject);
            m.setText(body);
            sender.send(m);
        };
    }
}
