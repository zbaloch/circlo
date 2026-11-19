package com.circlo.server.notify;

import com.circlo.server.web.Ids;
import com.circlo.server.web.RateLimiter;
import java.nio.ByteBuffer;
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
 * Tells people something happened for them, once the change is committed: their open apps wake up at once (live
 * signal), and replies, messages, friend requests and new friends are counted towards their calm daily note
 * (DailyDigests). Each is also pushed to my phones at once (owner decision 2026-11-18), content-free: a fixed text and
 * random ids so a tap opens the right screen, at most once a minute per chat, post or kind, unless I turned that kind
 * off (Settings, Notifications). New posts I can see only count towards the evening reminder. Someone I blocked is
 * never counted or pushed for me.
 */
@Component
public class Notifier {

    private static final Logger log = LoggerFactory.getLogger(Notifier.class);
    /** Each push kind's setting (users columns, from fixed values only). */
    private static final Map<String, String> SETTING = Map.of("message", "push_messages", "reply", "push_replies", "request", "push_friends",
            "friend", "push_friends");

    private final JdbcTemplate jdbc;
    private final Signals signals;
    private final DailyDigests daily;
    private final PhonePush phones;
    private final RateLimiter limiter;
    private final ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();

    public Notifier(JdbcTemplate jdbc, Signals signals, DailyDigests daily, PhonePush phones, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.signals = signals;
        this.daily = daily;
        this.phones = phones;
        this.limiter = limiter;
    }

    /** Wakes these people's open apps (and my own other devices when I'm one of them). */
    public void changed(Collection<UUID> users) {
        List<UUID> copy = List.copyOf(users);
        afterCommit(() -> copy.forEach(signals::bump));
    }

    public void changed(byte[]... users) {
        changed(Arrays.stream(users).map(Ids::uuid).toList());
    }

    /** A reply on my post, or to my reply. */
    public void reply(byte[] postAuthor, byte[] replier, UUID postId, UUID replyId) {
        count(postAuthor, replier, "reply", () -> push(postAuthor, "reply", postId,
                new PushSender.Message("New reply", Map.of("type", "reply", "postId", postId.toString(), "replyId", replyId.toString()))));
    }

    /** A message in one of my chats. */
    public void message(byte[] recipient, byte[] sender, UUID chatId) {
        count(recipient, sender, "message", () -> push(recipient, "message", chatId,
                new PushSender.Message("New message", Map.of("type", "message", "chatId", chatId.toString()))));
    }

    /** Someone asked to connect. */
    public void request(byte[] recipient, byte[] requester) {
        count(recipient, requester, "request", () -> push(recipient, "request", null,
                new PushSender.Message("New friend request", Map.of("type", "request"))));
    }

    /** Someone accepted my friend request: a new friend. */
    public void accepted(byte[] requester, byte[] accepter) {
        count(requester, accepter, "joined", () -> push(requester, "friend", null,
                new PushSender.Message("Your friend request was accepted", Map.of("type", "friend"))));
    }

    /** Someone joined with my invite link (we're connected; I may want to choose their circles). */
    public void joined(byte[] owner, byte[] joiner) {
        count(owner, joiner, "joined", () -> push(owner, "friend", null,
                new PushSender.Message("Someone joined with your invite link", Map.of("type", "friend"))));
    }

    /** A new post: counted towards the evening reminder of everyone who may see it (`readers`, never the author). */
    public void posted(byte[] author, Collection<UUID> readers) {
        List<UUID> copy = List.copyOf(readers);
        for (UUID r : copy) {
            count(Ids.bytes(r), author, "post", () -> { });
        }
    }

    /** Pushes to my phones unless I turned this kind off, at most once a minute per kind and chat or post (a burst is one push; the app shows the rest). */
    private void push(byte[] recipient, String kind, UUID about, PushSender.Message message) {
        ByteBuffer key = ByteBuffer.allocate(32).put(recipient);
        if (about != null) {
            key.putLong(about.getMostSignificantBits()).putLong(about.getLeastSignificantBits());
        }
        List<Boolean> on = jdbc.queryForList("SELECT " + SETTING.get(kind) + " FROM users WHERE id = ?", Boolean.class, (Object) recipient);
        if (on.isEmpty() || !on.get(0)) {
            return;
        }
        if (limiter.tryAcquire(kind + "-push", key.array(), 1, 60_000)) {
            phones.send(recipient, message);
        }
    }

    /** Counts towards the daily note, then runs `then` (both skipped for someone the recipient blocked). */
    private void count(byte[] recipient, byte[] actor, String type, Runnable then) {
        if (Arrays.equals(recipient, actor)) {
            return;
        }
        afterCommit(() -> pool.execute(() -> {
            try {
                if (jdbc.queryForList("SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?", recipient, actor).isEmpty()) {
                    daily.add(recipient, type);
                    then.run();
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
