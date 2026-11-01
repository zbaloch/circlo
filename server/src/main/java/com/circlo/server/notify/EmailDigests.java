package com.circlo.server.notify;

import com.circlo.server.config.ServerSecrets;
import com.circlo.server.mail.EmailSender;
import com.circlo.server.web.Ids;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Notification emails for people without the app on a phone. Replies, messages and requests are counted per person and
 * sent as one short email a while after the first ("You have 2 new replies and a friend request"), with no names or
 * text, a link to the web app and a one-click unsubscribe link (signed, so it needs no stored token).
 */
@Component
public class EmailDigests {

    private static final Logger log = LoggerFactory.getLogger(EmailDigests.class);
    private static final Map<String, String> COLUMNS = Map.of("reply", "replies", "message", "messages", "request", "requests", "joined", "friends");

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final EmailSender mail;
    private final NotifyProperties props;
    private final SecretKeySpec unsubscribeKey;

    public EmailDigests(JdbcTemplate jdbc, TransactionTemplate tx, EmailSender mail, NotifyProperties props, ServerSecrets secrets) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.mail = mail;
        this.props = props;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secrets.jwtKey(), "HmacSHA256"));
            unsubscribeKey = new SecretKeySpec(mac.doFinal("circlo.unsubscribe.v1".getBytes(StandardCharsets.UTF_8)), "HmacSHA256");
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Counts one notification (reply, message or request) towards this person's next email, if they get emails. */
    public void add(byte[] user, String type) {
        String column = COLUMNS.get(type);
        if (column == null) {
            return;
        }
        jdbc.update("INSERT INTO email_digests (user_id, " + column + ", first_at) SELECT id, 1, ? FROM users"
                + " WHERE id = ? AND status = 'active' AND email_notifications = TRUE"
                + " ON DUPLICATE KEY UPDATE " + column + " = " + column + " + 1", Timestamp.from(Instant.now()), user);
    }

    @Scheduled(fixedDelay = 60_000, initialDelay = 60_000)
    void sendDue() {
        sendDue(Instant.now());
    }

    /** Sends every email whose first notification is at least the delay old at `now`; returns how many were sent. */
    public int sendDue(Instant now) {
        List<byte[]> due = jdbc.query("SELECT user_id FROM email_digests WHERE first_at <= ?", (rs, i) -> rs.getBytes(1),
                Timestamp.from(now.minus(props.emailDelay())));
        int sent = 0;
        for (byte[] user : due) {
            if (sendOne(user)) {
                sent++;
            }
        }
        return sent;
    }

    private record Digest(int replies, int messages, int requests, int friends, String email, boolean on) {}

    private boolean sendOne(byte[] user) {
        // Taken and removed together, so a notification arriving meanwhile starts the next email instead of being lost.
        List<Digest> rows = tx.execute(s -> {
            List<Digest> r = jdbc.query("""
                    SELECT d.replies, d.messages, d.requests, d.friends, u.email, u.email_notifications FROM email_digests d
                    JOIN users u ON u.id = d.user_id WHERE d.user_id = ? AND u.status = 'active' FOR UPDATE""",
                    (rs, i) -> new Digest(rs.getInt(1), rs.getInt(2), rs.getInt(3), rs.getInt(4), rs.getString(5), rs.getBoolean(6)), (Object) user);
            jdbc.update("DELETE FROM email_digests WHERE user_id = ?", (Object) user);
            return r;
        });
        if (rows == null || rows.isEmpty() || !rows.get(0).on()) {
            return false;
        }
        Digest d = rows.get(0);
        String summary = summary(d.replies(), d.messages(), d.requests(), d.friends());
        if (summary.isEmpty()) {
            return false;
        }
        String unsubscribe = unsubscribeUrl(Ids.uuid(user));
        try {
            mail.send(d.email(), "New on Circlo: " + summary, """
                    You have %s on Circlo.

                    See them: %s/notifications

                    You get these emails because you're not signed in to the Circlo app on a phone. With the app, \
                    you're told on your phone instead and get no emails.

                    Turn these emails off: %s
                    """.formatted(summary, props.webBase(), unsubscribe),
                    Map.of("List-Unsubscribe", "<" + unsubscribe + ">", "List-Unsubscribe-Post", "List-Unsubscribe=One-Click"));
            return true;
        } catch (RuntimeException e) {
            // No details: they could include the address.
            log.warn("notification email failed ({})", e.getClass().getSimpleName());
            return false;
        }
    }

    /** "2 new replies, a new message and a friend request" (empty if all are zero). Friends: people who joined with my link. */
    static String summary(int replies, int messages, int requests, int friends) {
        List<String> parts = new ArrayList<>();
        if (replies > 0) {
            parts.add(replies == 1 ? "a new reply" : replies + " new replies");
        }
        if (messages > 0) {
            parts.add(messages == 1 ? "a new message" : messages + " new messages");
        }
        if (requests > 0) {
            parts.add(requests == 1 ? "a friend request" : requests + " friend requests");
        }
        if (friends > 0) {
            parts.add(friends == 1 ? "a new friend" : friends + " new friends");
        }
        if (parts.size() <= 1) {
            return String.join("", parts);
        }
        return String.join(", ", parts.subList(0, parts.size() - 1)) + " and " + parts.get(parts.size() - 1);
    }

    String unsubscribeUrl(UUID user) {
        return props.apiBase() + "/v1/email/unsubscribe?u=" + user + "&t=" + unsubscribeToken(user);
    }

    String unsubscribeToken(UUID user) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(unsubscribeKey);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(Arrays.copyOf(mac.doFinal(Ids.bytes(user)), 18));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Turns notification emails off for the person this link was made for; false if the link isn't genuine. */
    public boolean unsubscribe(UUID user, String token) {
        if (!MessageDigest.isEqual(unsubscribeToken(user).getBytes(StandardCharsets.US_ASCII), token.getBytes(StandardCharsets.US_ASCII))) {
            return false;
        }
        jdbc.update("UPDATE users SET email_notifications = FALSE WHERE id = ?", (Object) Ids.bytes(user));
        jdbc.update("DELETE FROM email_digests WHERE user_id = ?", (Object) Ids.bytes(user));
        return true;
    }
}
