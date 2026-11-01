package com.circlo.server.notify;

import com.circlo.server.web.Ids;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
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
 * Tells people something happened for them, once the change is committed: their open apps wake up at once (live
 * signal), and replies, messages, friend requests and new friends are counted towards their calm daily note
 * (DailyDigests). Someone I blocked is never counted for me.
 */
@Component
public class Notifier {

    private static final Logger log = LoggerFactory.getLogger(Notifier.class);

    private final JdbcTemplate jdbc;
    private final Signals signals;
    private final DailyDigests daily;
    private final ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();

    public Notifier(JdbcTemplate jdbc, Signals signals, DailyDigests daily) {
        this.jdbc = jdbc;
        this.signals = signals;
        this.daily = daily;
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
        count(postAuthor, replier, "reply");
    }

    /** A message in one of my chats. */
    public void message(byte[] recipient, byte[] sender, UUID chatId) {
        count(recipient, sender, "message");
    }

    /** Someone asked to connect. */
    public void request(byte[] recipient, byte[] requester) {
        count(recipient, requester, "request");
    }

    /** Someone joined with my invite link (we're connected; I may want to choose their circles). */
    public void joined(byte[] owner, byte[] joiner) {
        count(owner, joiner, "joined");
    }

    private void count(byte[] recipient, byte[] actor, String type) {
        if (Arrays.equals(recipient, actor)) {
            return;
        }
        afterCommit(() -> pool.execute(() -> {
            try {
                if (jdbc.queryForList("SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?", recipient, actor).isEmpty()) {
                    daily.add(recipient, type);
                }
            } catch (RuntimeException e) {
                log.warn("counting a notification failed ({})", e.getClass().getSimpleName());
            }
        }));
    }

    /** Runs `task` once the current transaction commits (at once if there's none). */
    static void afterCommit(Runnable task) {
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
