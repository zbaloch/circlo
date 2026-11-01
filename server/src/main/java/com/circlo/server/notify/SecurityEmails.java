package com.circlo.server.notify;

import com.circlo.server.mail.EmailSender;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Account events, emailed straight away and whatever the notification settings (owner decision 2026-11-01): a new
 * sign-in, a password changed or reset, another device signed out from the Devices list (signing myself out sends
 * nothing). They say what happened and, for a device, only its kind
 * (iPhone, Android phone, browser): never where from, never an address, never which network.
 */
@Component
public class SecurityEmails {

    private static final Logger log = LoggerFactory.getLogger(SecurityEmails.class);
    private static final String FOOTER = """

            This is a security email: it's sent whenever this happens, even if you've turned other emails off.
            """;

    private final JdbcTemplate jdbc;
    private final EmailSender mail;
    private final NotifyProperties props;
    private final ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();

    public SecurityEmails(JdbcTemplate jdbc, EmailSender mail, NotifyProperties props) {
        this.jdbc = jdbc;
        this.mail = mail;
        this.props = props;
    }

    public void signIn(byte[] user) {
        send(user, "New sign-in to your Circlo account", """
                Someone just signed in to your Circlo account.

                If it was you, there's nothing to do.

                If it wasn't, change your password now in Settings (%s/settings). Changing it signs you out everywhere else.
                """.formatted(props.webBase()));
    }

    public void passwordChanged(byte[] user) {
        send(user, "Your Circlo password was changed", """
                Your password was just changed, and your account was signed out everywhere else.

                If it was you, there's nothing to do.

                If it wasn't, reset your password straight away: choose "Forgot password?" when signing in at %s.
                """.formatted(props.webBase()));
    }

    /** `kind`: ios, android, web, or null (signed in before the kind was recorded). */
    public void signedOut(byte[] user, String kind) {
        String device = deviceLabel(kind);
        send(user, device + " was signed out of your Circlo account", """
                %s was just signed out of your Circlo account.

                If it was you, there's nothing to do.

                If it wasn't, change your password now in Settings (%s/settings). Changing it signs you out everywhere else.
                """.formatted(device, props.webBase()));
    }

    static String deviceLabel(String kind) {
        if (kind == null) {
            return "A device";
        }
        return switch (kind) {
            case "ios" -> "An iPhone";
            case "android" -> "An Android phone";
            case "web" -> "A browser";
            default -> "A device";
        };
    }

    private void send(byte[] user, String subject, String body) {
        Notifier.afterCommit(() -> pool.execute(() -> {
            try {
                List<String> email = jdbc.queryForList("SELECT email FROM users WHERE id = ? AND status = 'active'", String.class, (Object) user);
                if (!email.isEmpty()) {
                    mail.send(email.get(0), subject, body + FOOTER);
                }
            } catch (RuntimeException e) {
                // No details: they could include the address.
                log.warn("security email failed ({})", e.getClass().getSimpleName());
            }
        }));
    }
}
