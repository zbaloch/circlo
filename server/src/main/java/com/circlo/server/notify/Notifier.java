package com.circlo.server.notify;

import com.circlo.server.web.Ids;
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
 * for replies, messages and friend requests their phones (iPhone via APNs, Android via FCM) get a content-free push. Someone I blocked never makes my
 * phone buzz. Pushes go out on background threads so a slow Apple never slows a request.
 */
@Component
public class Notifier {

    private static final Logger log = LoggerFactory.getLogger(Notifier.class);

    private final JdbcTemplate jdbc;
    private final Signals signals;
    private final PushSender sender;
    private final PushTokens tokens;
    private final ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();

    public Notifier(JdbcTemplate jdbc, Signals signals, PushSender sender, PushTokens tokens) {
        this.jdbc = jdbc;
        this.signals = signals;
        this.sender = sender;
        this.tokens = tokens;
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

    private void push(byte[] recipient, byte[] actor, PushSender.Message message) {
        if (Arrays.equals(recipient, actor) || !sender.enabled()) {
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
            List<Device> devices = jdbc.query(
                    "SELECT id, push_token_enc, push_service FROM devices WHERE user_id = ? AND revoked_at IS NULL AND push_token_enc IS NOT NULL",
                    (rs, i) -> new Device(rs.getBytes(1), rs.getBytes(2), rs.getString(3)), (Object) recipient);
            for (Device d : devices) {
                String token = tokens.open(d.id(), d.sealed());
                PushSender.Result result = token == null ? PushSender.Result.UNREGISTERED : sender.send(d.service(), token, message);
                if (result == PushSender.Result.UNREGISTERED) {
                    jdbc.update("UPDATE devices SET push_token_enc = NULL, push_service = NULL WHERE id = ?", (Object) d.id());
                }
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
