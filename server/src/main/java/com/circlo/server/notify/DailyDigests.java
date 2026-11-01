package com.circlo.server.notify;

import com.circlo.server.config.ServerSecrets;
import com.circlo.server.mail.EmailSender;
import com.circlo.server.web.Ids;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
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
 * Activity is told once a day, calmly (owner decision 2026-11-01). Replies, messages, requests and new friends are
 * counted per person and, at the hour their app chose (default 18:00 UTC), they're told on one channel, and only on
 * days something happened:
 * <ul>
 *   <li>signed in to the app on a phone: one push, "You have a few new things waiting", never an email, even if they
 *       also use the web app. A phone with notifications turned off still counts: they chose silence.</li>
 *   <li>no app (only the web app, or nothing): one email naming the kinds of things waiting, with a link to the web
 *       app and a one-click unsubscribe link (signed, so it needs no stored token).</li>
 * </ul>
 * Neither says who, what or how many. An app counts while its session is alive (not signed out, not lapsed) and Apple
 * or Google haven't said its push token is dead; if they say so now, that day's note comes by email instead.
 */
@Component
public class DailyDigests {

    static final String PUSH = "You have a few new things waiting. Catch up when you’re ready.";
    static final String SUBJECT = "Your day on Circlo";

    private static final Logger log = LoggerFactory.getLogger(DailyDigests.class);
    private static final Map<String, String> COLUMNS = Map.of("reply", "replies", "message", "messages", "request", "requests", "joined", "friends");
    /** At most one a day, even if someone moves their hour later. */
    private static final Duration MIN_GAP = Duration.ofHours(20);

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final EmailSender mail;
    private final NotifyProperties props;
    private final PushSender sender;
    private final PushTokens tokens;
    private final SecretKeySpec unsubscribeKey;

    public DailyDigests(JdbcTemplate jdbc, TransactionTemplate tx, EmailSender mail, NotifyProperties props, PushSender sender,
            PushTokens tokens, ServerSecrets secrets) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.mail = mail;
        this.props = props;
        this.sender = sender;
        this.tokens = tokens;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secrets.jwtKey(), "HmacSHA256"));
            unsubscribeKey = new SecretKeySpec(mac.doFinal("circlo.unsubscribe.v1".getBytes(StandardCharsets.UTF_8)), "HmacSHA256");
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Counts one thing (reply, message, request or joined) towards this person's next daily note. */
    public void add(byte[] user, String type) {
        String column = COLUMNS.get(type);
        if (column == null) {
            return;
        }
        jdbc.update("INSERT INTO daily_digests (user_id, " + column + ", first_at) SELECT id, 1, ? FROM users WHERE id = ? AND status = 'active'"
                + " ON DUPLICATE KEY UPDATE " + column + " = " + column + " + 1, first_at = COALESCE(first_at, VALUES(first_at))",
                Timestamp.from(Instant.now()), user);
    }

    @Scheduled(fixedDelay = 300_000, initialDelay = 60_000)
    void sendScheduled() {
        if (props.dailyScheduled()) {
            sendDue(Instant.now());
        }
    }

    /** Tells everyone whose hour it is at `now` (UTC) and who has something waiting; returns how many were told. */
    public int sendDue(Instant now) {
        List<byte[]> due = jdbc.query("""
                SELECT d.user_id FROM daily_digests d JOIN users u ON u.id = d.user_id
                WHERE d.first_at IS NOT NULL AND u.status = 'active' AND u.digest_hour = ? AND (d.sent_at IS NULL OR d.sent_at < ?)""",
                (rs, i) -> rs.getBytes(1), now.atZone(ZoneOffset.UTC).getHour(), Timestamp.from(now.minus(MIN_GAP)));
        int told = 0;
        for (byte[] user : due) {
            try {
                if (sendOne(user, now)) {
                    told++;
                }
            } catch (RuntimeException e) {
                // No details: they could include tokens or the address.
                log.warn("daily notification failed ({})", e.getClass().getSimpleName());
            }
        }
        return told;
    }

    private record Digest(int replies, int messages, int requests, int friends, String email, boolean emailOn) {}

    private boolean sendOne(byte[] user, Instant now) {
        // Taken and cleared together, so what arrives meanwhile waits for the next day instead of being lost.
        Digest d = tx.execute(s -> {
            List<Digest> r = jdbc.query("""
                    SELECT d.replies, d.messages, d.requests, d.friends, u.email, u.email_notifications FROM daily_digests d
                    JOIN users u ON u.id = d.user_id WHERE d.user_id = ? AND d.first_at IS NOT NULL FOR UPDATE""",
                    (rs, i) -> new Digest(rs.getInt(1), rs.getInt(2), rs.getInt(3), rs.getInt(4), rs.getString(5), rs.getBoolean(6)), (Object) user);
            jdbc.update("UPDATE daily_digests SET replies = 0, messages = 0, requests = 0, friends = 0, first_at = NULL, sent_at = ? WHERE user_id = ?",
                    Timestamp.from(now), user);
            return r.isEmpty() ? null : r.get(0);
        });
        if (d == null) {
            return false;
        }
        String summary = summary(d.replies(), d.messages(), d.requests(), d.friends());
        if (summary.isEmpty()) {
            return false;
        }
        if (toldOnPhones(user)) {
            return true;
        }
        if (!d.emailOn()) {
            return false;
        }
        String unsubscribe = unsubscribeUrl(Ids.uuid(user));
        mail.send(d.email(), SUBJECT, """
                You have %s waiting on Circlo.

                Catch up whenever you like: %s/notifications

                This note comes at most once a day, and only on days something happens. It comes by email because \
                you're not signed in to the Circlo app on a phone; with the app, it comes there instead.

                Turn these emails off: %s
                """.formatted(summary, props.webBase(), unsubscribe),
                Map.of("List-Unsubscribe", "<" + unsubscribe + ">", "List-Unsubscribe-Post", "List-Unsubscribe=One-Click"));
        return true;
    }

    /**
     * Pushes the day's note to my phone apps. True if I have one that still counts (even with notifications off), so
     * no email; false if I have none, or Apple and Google just said every one of them is gone.
     */
    private boolean toldOnPhones(byte[] user) {
        record Device(byte[] id, byte[] sealed, String service) {}
        // Devices from before the kind was recorded count when they have a push token.
        List<Device> apps = jdbc.query("""
                SELECT d.id, d.push_token_enc, d.push_service FROM devices d
                WHERE d.user_id = ? AND d.revoked_at IS NULL AND d.push_lost = FALSE
                  AND (d.kind IN ('ios', 'android') OR d.push_token_enc IS NOT NULL)
                  AND EXISTS (SELECT 1 FROM refresh_tokens t WHERE t.device_id = d.id AND t.revoked_at IS NULL AND t.expires_at > ?)""",
                (rs, i) -> new Device(rs.getBytes(1), rs.getBytes(2), rs.getString(3)), user, Timestamp.from(Instant.now()));
        int reachable = apps.size();
        PushSender.Message message = new PushSender.Message(PUSH, Map.of("type", "digest"));
        for (Device d : apps) {
            if (d.sealed() == null) {
                continue; // notifications are off on that phone
            }
            String token = tokens.open(d.id(), d.sealed());
            PushSender.Result result = token == null ? PushSender.Result.UNREGISTERED : sender.send(d.service(), token, message);
            if (result == PushSender.Result.UNREGISTERED) {
                jdbc.update("UPDATE devices SET push_token_enc = NULL, push_service = NULL, push_lost = TRUE WHERE id = ?", (Object) d.id());
                reachable--;
            }
        }
        return reachable > 0;
    }

    /** "new replies, a new message and a friend request": the kinds waiting, never how many (empty if none). */
    static String summary(int replies, int messages, int requests, int friends) {
        List<String> parts = new ArrayList<>();
        if (replies > 0) {
            parts.add(replies == 1 ? "a new reply" : "new replies");
        }
        if (messages > 0) {
            parts.add(messages == 1 ? "a new message" : "new messages");
        }
        if (requests > 0) {
            parts.add(requests == 1 ? "a friend request" : "friend requests");
        }
        if (friends > 0) {
            parts.add(friends == 1 ? "a new friend" : "new friends");
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

    /** Turns the daily emails off for the person this link was made for; false if the link isn't genuine. */
    public boolean unsubscribe(UUID user, String token) {
        if (!MessageDigest.isEqual(unsubscribeToken(user).getBytes(StandardCharsets.US_ASCII), token.getBytes(StandardCharsets.US_ASCII))) {
            return false;
        }
        jdbc.update("UPDATE users SET email_notifications = FALSE WHERE id = ?", (Object) Ids.bytes(user));
        return true;
    }
}
