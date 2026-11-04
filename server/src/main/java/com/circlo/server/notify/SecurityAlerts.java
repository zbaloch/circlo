package com.circlo.server.notify;

import com.circlo.server.mail.EmailSender;
import com.circlo.server.web.Ids;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Account events, sent straight away and whatever the notification settings (owner decisions 2026-11-01 and
 * 2026-11-04): a new sign-in, a password changed or reset, another device signed out from the Devices list (signing
 * myself out sends nothing). Each is emailed, and pushed to the account's phones that have notifications on, except
 * the device that did it. They say what happened and, for a device, only its kind (iPhone, Android phone, browser):
 * never where from, never an address, never which network.
 *
 * <p>Call these before the devices are signed out in the same transaction: the phones to tell are read at the call,
 * so a phone that is being signed out still hears why. Nothing is sent unless the transaction commits.
 */
@Component
public class SecurityAlerts {

    private static final Logger log = LoggerFactory.getLogger(SecurityAlerts.class);
    private static final String FOOTER = """

            This is a security email: it's sent whenever this happens, even if you've turned other emails off.
            """;
    static final String SIGN_IN_PUSH = "New sign-in to your Circlo account. If it wasn’t you, change your password in Settings.";
    static final String PASSWORD_PUSH = "Your Circlo password was changed. If it wasn’t you, reset it with “Forgot password?”.";
    /** Opens the app's timeline, where a new sign-in is shown in full. */
    private static final Map<String, String> DATA = Map.of("type", "security");

    private final JdbcTemplate jdbc;
    private final EmailSender mail;
    private final NotifyProperties props;
    private final PushSender sender;
    private final PushTokens tokens;
    private final ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();

    public SecurityAlerts(JdbcTemplate jdbc, EmailSender mail, NotifyProperties props, PushSender sender, PushTokens tokens) {
        this.jdbc = jdbc;
        this.mail = mail;
        this.props = props;
        this.sender = sender;
        this.tokens = tokens;
    }

    /** Call before the new device is created: every phone already signed in hears about it. */
    public void signIn(byte[] user) {
        send(user, null, SIGN_IN_PUSH, "New sign-in to your Circlo account", """
                Someone just signed in to your Circlo account.

                If it was you, there's nothing to do.

                If it wasn't, change your password now in Settings (%s/settings). Changing it signs you out everywhere else.
                """.formatted(props.webBase()));
    }

    /** `actingDevice`: the device that changed it (not told), or null for a reset with an email code. */
    public void passwordChanged(byte[] user, UUID actingDevice) {
        send(user, actingDevice, PASSWORD_PUSH, "Your Circlo password was changed", """
                Your password was just changed, and your account was signed out everywhere else.

                If it was you, there's nothing to do.

                If it wasn't, reset your password straight away: choose "Forgot password?" when signing in at %s.
                """.formatted(props.webBase()));
    }

    /** `kind`: ios, android, web, or null (signed in before the kind was recorded). `actingDevice` isn't told. */
    public void signedOut(byte[] user, String kind, UUID actingDevice) {
        String device = deviceLabel(kind);
        send(user, actingDevice, device + " was signed out of your Circlo account. If it wasn’t you, change your password in Settings.",
                device + " was signed out of your Circlo account", """
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

    private record Phone(byte[] id, byte[] sealed, String service) {}

    private void send(byte[] user, UUID except, String push, String subject, String body) {
        byte[] skip = except == null ? null : Ids.bytes(except);
        // Read now, while the devices are still signed in (signing out forgets their push tokens).
        List<Phone> phones = jdbc.query("""
                SELECT id, push_token_enc, push_service FROM devices
                WHERE user_id = ? AND revoked_at IS NULL AND push_token_enc IS NOT NULL AND push_service IS NOT NULL""",
                (rs, i) -> new Phone(rs.getBytes(1), rs.getBytes(2), rs.getString(3)), (Object) user)
                .stream().filter(p -> skip == null || !Arrays.equals(p.id(), skip)).toList();
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
            push(phones, push);
        }));
    }

    private void push(List<Phone> phones, String alert) {
        if (phones.isEmpty() || !sender.enabled()) {
            return;
        }
        PushSender.Message message = new PushSender.Message(alert, DATA);
        for (Phone p : phones) {
            try {
                String token = tokens.open(p.id(), p.sealed());
                PushSender.Result result = token == null ? PushSender.Result.UNREGISTERED : sender.send(p.service(), token, message);
                if (result == PushSender.Result.UNREGISTERED) {
                    // Apple or Google say the app is gone from that phone (as for the daily note).
                    jdbc.update("UPDATE devices SET push_token_enc = NULL, push_service = NULL, push_lost = TRUE WHERE id = ? AND revoked_at IS NULL",
                            (Object) p.id());
                }
            } catch (RuntimeException e) {
                log.warn("security push failed ({})", e.getClass().getSimpleName());
            }
        }
    }
}
