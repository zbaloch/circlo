package com.circlo.server.mail;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;

@Configuration
public class MailConfig {

    private static final Logger log = LoggerFactory.getLogger(MailConfig.class);

    @Bean
    EmailSender emailSender(MailProperties props, ObjectProvider<JavaMailSender> smtp,
            @Value("${spring.mail.host:}") String host) {
        if (props.mode().equals("log")) {
            log.warn("circlo.mail.mode=log: emails are printed to this console instead of being sent (local development only)");
            // The body only (it holds the code a developer needs); never the recipient.
            return (to, subject, body, headers) -> log.info("[dev mail] {}\n{}", subject, body);
        }
        JavaMailSender sender = smtp.getIfAvailable();
        if (sender == null || host.isBlank()) {
            throw new IllegalStateException("CIRCLO_MAIL_HOST is not set (or set CIRCLO_MAIL_MODE=log for local development)");
        }
        return (to, subject, body, headers) -> {
            try {
                MimeMessage m = sender.createMimeMessage();
                MimeMessageHelper h = new MimeMessageHelper(m, false, "UTF-8");
                h.setFrom(props.from());
                h.setTo(to);
                h.setSubject(subject);
                h.setText(body);
                for (Map.Entry<String, String> e : headers.entrySet()) {
                    m.setHeader(e.getKey(), e.getValue());
                }
                sender.send(m);
            } catch (MessagingException e) {
                throw new IllegalStateException("email could not be built", e);
            }
        };
    }
}
