package com.circlo.server.notify;

import com.circlo.server.web.Ids;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Tells people something happened for them, once the change is committed: their open apps wake up (live signal), and
 * for replies, messages and friend requests they're told on one channel (owner decision 2026-11-01):
 * <ul>
 *   <li>signed in to the app on a phone: a content-free push (iPhone via APNs, Android via FCM), never an email, even
 *       if they also use the web app. A phone with notifications turned off still counts: they chose silence.</li>
 *   <li>no app (only the web app, or nothing): a short email, gathered with what follows (EmailDigests).</li>
 * </ul>
 * An app counts while its session is alive (not signed out, not lapsed) and Apple or Google haven't said its push token
 * is dead. Someone I blocked is never announced to me. Delivery runs on background threads so a slow Apple never slows
 * a request.
 */
@Component
public class Notifier {

    private static final Logger log = LoggerFactory.getLogger(Notifier.class);

    private final JdbcTemplate jdbc;
    private final Signals signals;
    private final PushSender sender;
    private final PushTokens tokens;
    private final EmailDigests emails;
    private final ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();

    public Notifier(JdbcTemplate jdbc, Signals signals, PushSender sender, PushTokens tokens, EmailDigests emails) {
        this.jdbc = jdbc;
        this.signals = signals;
        this.sender = sender;
        this.tokens = tokens;
        this.emails = emails;
    }

    /** Wakes these people's open apps (and my own other devices when I'm one of them). */
    public void changed(Collection<UUID> users) {
        List<UUID> copy = List.copyOf(users);
        afterCommit(() -> copy.forEach(signals::bump));
    }

    public void changed(byte[]... users) {
        changed(Arrays.stream(users).map(Ids::uuid).toList());
    }

    /** A reply on my post. */
    public void reply(byte[] postAuthor, byte[] replier, UUID postId, UUID replyId) {
        push(postAuthor, replier, new PushSender.Message("New reply", Map.of("type", "reply", "postId", postId.toString(), "replyId", replyId.toString())));
    }

    /** A message in one of my chats. */
    public void message(byte[] recipient, byte[] sender, UUID chatId) {
        push(recipient, sender, new PushSender.Message("New message", Map.of("type", "message", "chatId", chatId.toString())));
    }

    /** Someone asked to connect. */
    public void request(byte[] recipient, byte[] requester) {
        push(recipient, requester, new PushSender.Message("New friend request", Map.of("type", "request")));
    }

    /** Someone joined with my invite link (we're connected; I may want to choose their circles). */
    public void joined(byte[] owner, byte[] joiner) {
        push(owner, joiner, new PushSender.Message("New friend", Map.of("type", "joined")));
    }

    private void push(byte[] recipient, byte[] actor, PushSender.Message message) {
        if (Arrays.equals(recipient, actor)) {
            return;
        }
        afterCommit(() -> pool.execute(() -> deliver(recipient, actor, message)));
    }

    private void deliver(byte[] recipient, byte[] actor, PushSender.Message message) {
        try {
            if (!jdbc.queryForList("SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?", recipient, actor).isEmpty()) {
                return;
            }
            record Device(byte[] id, byte[] sealed, String service) {}
            // My phone apps: signed in with a live session, and not reported gone by Apple or Google. Devices from
            // before the kind was recorded count when they have a push token.
            List<Device> apps = jdbc.query("""
                    SELECT d.id, d.push_token_enc, d.push_service FROM devices d
                    WHERE d.user_id = ? AND d.revoked_at IS NULL AND d.push_lost = FALSE
                      AND (d.kind IN ('ios', 'android') OR d.push_token_enc IS NOT NULL)
                      AND EXISTS (SELECT 1 FROM refresh_tokens t WHERE t.device_id = d.id AND t.revoked_at IS NULL AND t.expires_at > ?)""",
                    (rs, i) -> new Device(rs.getBytes(1), rs.getBytes(2), rs.getString(3)), recipient, Timestamp.from(Instant.now()));
            int reachable = apps.size();
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
            if (reachable == 0) {
                emails.add(recipient, message.data().get("type"));
            }
        } catch (RuntimeException e) {
            // No details: they could include tokens or ids.
            log.warn("push delivery failed ({})", e.getClass().getSimpleName());
        }
    }

    private static void afterCommit(Runnable task) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    task.run();
                }
            });
        } else {
            task.run();
        }
    }
}
