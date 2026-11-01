package com.circlo.server.chats;

import com.circlo.server.auth.TokenService;
import com.circlo.server.notify.Notifier;
import com.circlo.server.media.Attachments;
import com.circlo.server.media.MediaSweeper;
import com.circlo.server.social.People;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import com.circlo.server.web.RateLimiter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Chats: a 1:1 chat or a group of friends. Only members can read or post; people can only be added by a member they're
 * friends with. Read state is kept per member, so it follows them across their devices. Messages from people I blocked
 * are left out for me.
 */
@RestController
public class ChatController {

    static final int MAX_CHARS = 2000;
    static final int MAX_MEMBERS = 50;

    private final JdbcTemplate jdbc;
    private final People people;
    private final Attachments attachments;
    private final RateLimiter limiter;

    private final Notifier notifier;

    public ChatController(JdbcTemplate jdbc, People people, Attachments attachments, RateLimiter limiter, Notifier notifier) {
        this.notifier = notifier;
        this.jdbc = jdbc;
        this.people = people;
        this.attachments = attachments;
        this.limiter = limiter;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(TokenService.userOf(jwt));
    }

    private static Timestamp now() {
        return Timestamp.from(Instant.now());
    }

    private void requireMember(byte[] chat, byte[] me) {
        if (jdbc.queryForList("SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?", chat, me).isEmpty()) {
            throw ApiException.notFound();
        }
    }

    private List<UUID> members(byte[] chat) {
        return jdbc.query("SELECT user_id FROM chat_members WHERE chat_id = ? ORDER BY joined_at", (rs, i) -> Ids.uuid(rs.getBytes(1)),
                (Object) chat);
    }

    /** Each person must be my accepted friend, and nobody may be blocked either way. */
    private void requireFriends(byte[] me, List<UUID> userIds) {
        for (UUID u : userIds) {
            byte[] other = Ids.bytes(u);
            if (!people.friends(me, other) || people.blockedEitherWay(me, other)) {
                throw ApiException.badRequest("not_a_friend");
            }
        }
    }

    // ---------- views ----------

    public record MessageView(long seq, UUID messageId, UUID senderId, String text, List<Attachments.AttachmentView> media,
            Instant createdAt) {}

    /** `members`: everyone else in the chat. */
    public record ChatView(UUID chatId, String name, List<People.Person> members, MessageView lastMessage, int unread, long readSeq,
            Instant updatedAt) {}

    private List<MessageView> messages(String where, Object... args) {
        record Row(long seq, UUID id, UUID sender, String body, Instant at) {}
        List<Row> rows = jdbc.query("SELECT seq, id, sender_id, body, created_at FROM chat_messages " + where,
                (rs, i) -> new Row(rs.getLong(1), Ids.uuid(rs.getBytes(2)), Ids.uuid(rs.getBytes(3)), rs.getString(4),
                        rs.getTimestamp(5).toInstant()), args);
        Map<UUID, List<Attachments.AttachmentView>> media = attachments.of("message_id", rows.stream().map(Row::id).toList());
        return rows.stream().map(r -> new MessageView(r.seq(), r.id(), r.sender(), r.body(), media.getOrDefault(r.id(), List.of()), r.at()))
                .toList();
    }

    private static final String NOT_BLOCKED = " AND sender_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = ?)";

    private List<ChatView> chats(byte[] me, List<byte[]> chatIds) {
        if (chatIds.isEmpty()) {
            return List.of();
        }
        String marks = String.join(",", Collections.nCopies(chatIds.size(), "?"));
        Map<UUID, String> names = new HashMap<>();
        Map<UUID, Instant> created = new HashMap<>();
        jdbc.query("SELECT id, name, created_at FROM chats WHERE id IN (" + marks + ")", rs -> {
            names.put(Ids.uuid(rs.getBytes(1)), rs.getString(2));
            created.put(Ids.uuid(rs.getBytes(1)), rs.getTimestamp(3).toInstant());
        }, chatIds.toArray());
        Map<UUID, List<UUID>> others = new HashMap<>();
        Map<UUID, Long> readSeq = new HashMap<>();
        UUID self = Ids.uuid(me);
        jdbc.query("SELECT chat_id, user_id, read_seq FROM chat_members WHERE chat_id IN (" + marks + ") ORDER BY joined_at", rs -> {
            UUID chat = Ids.uuid(rs.getBytes(1));
            UUID user = Ids.uuid(rs.getBytes(2));
            if (user.equals(self)) {
                readSeq.put(chat, rs.getLong(3));
            } else {
                others.computeIfAbsent(chat, k -> new ArrayList<>()).add(user);
            }
        }, chatIds.toArray());
        Map<UUID, People.Person> persons = people.persons(others.values().stream().flatMap(List::stream).distinct().toList());
        List<ChatView> out = new ArrayList<>();
        for (byte[] chat : chatIds) {
            UUID id = Ids.uuid(chat);
            long read = readSeq.getOrDefault(id, 0L);
            List<MessageView> last = messages("WHERE chat_id = ?" + NOT_BLOCKED + " ORDER BY seq DESC LIMIT 1", chat, me);
            Integer unread = jdbc.queryForObject("SELECT COUNT(*) FROM chat_messages WHERE chat_id = ? AND seq > ? AND sender_id <> ?" + NOT_BLOCKED,
                    Integer.class, chat, read, me, me);
            List<People.Person> members = others.getOrDefault(id, List.of()).stream().filter(persons::containsKey).map(persons::get).toList();
            MessageView lastMessage = last.isEmpty() ? null : last.get(0);
            out.add(new ChatView(id, names.get(id), members, lastMessage, unread == null ? 0 : unread, read,
                    lastMessage != null ? lastMessage.createdAt() : created.get(id)));
        }
        out.sort((a, b) -> b.updatedAt().compareTo(a.updatedAt()));
        return out;
    }

    // ---------- chats ----------

    @GetMapping("/v1/chats")
    public List<ChatView> list(@AuthenticationPrincipal Jwt jwt) {
        byte[] me = me(jwt);
        return chats(me, jdbc.query("SELECT chat_id FROM chat_members WHERE user_id = ?", (rs, i) -> rs.getBytes(1), (Object) me));
    }

    @GetMapping("/v1/chats/{chatId}")
    public ChatView get(@AuthenticationPrincipal Jwt jwt, @PathVariable("chatId") UUID chatId) {
        byte[] me = me(jwt);
        requireMember(Ids.bytes(chatId), me);
        return chats(me, List.of(Ids.bytes(chatId))).get(0);
    }

    public record NewChat(@NotNull @Size(min = 1, max = MAX_MEMBERS - 1) List<UUID> userIds, @Size(max = 50) String name) {}

    /** Starts a chat with friends. A 1:1 chat with someone I already have one with is reused. */
    @PostMapping("/v1/chats")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public ChatView create(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody NewChat r) {
        byte[] me = me(jwt);
        UUID self = Ids.uuid(me);
        List<UUID> others = new ArrayList<>(new LinkedHashSet<>(r.userIds()));
        others.remove(self);
        if (others.isEmpty()) {
            throw ApiException.badRequest("no_members");
        }
        requireFriends(me, others);
        String name = r.name() == null || r.name().isBlank() ? null : r.name().strip();
        if (others.size() == 1 && name == null) {
            List<byte[]> existing = jdbc.query("""
                    SELECT c.id FROM chats c
                    JOIN chat_members a ON a.chat_id = c.id AND a.user_id = ?
                    JOIN chat_members b ON b.chat_id = c.id AND b.user_id = ?
                    WHERE c.name IS NULL AND (SELECT COUNT(*) FROM chat_members m WHERE m.chat_id = c.id) = 2 LIMIT 1""",
                    (rs, i) -> rs.getBytes(1), me, Ids.bytes(others.get(0)));
            if (!existing.isEmpty()) {
                return chats(me, existing).get(0);
            }
        }
        byte[] chat = Ids.bytes(Ids.newId());
        jdbc.update("INSERT INTO chats (id, name, created_by, created_at) VALUES (?, ?, ?, ?)", chat, name, me, now());
        jdbc.update("INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)", chat, me, now());
        for (UUID u : others) {
            jdbc.update("INSERT INTO chat_members (chat_id, user_id, joined_at) VALUES (?, ?, ?)", chat, Ids.bytes(u), now());
        }
        return chats(me, List.of(chat)).get(0);
    }

    public record AddMembers(@NotNull @Size(min = 1, max = MAX_MEMBERS) List<UUID> userIds) {}

    /** Adds my friends to a chat I'm in. They see messages from then on. */
    @PostMapping("/v1/chats/{chatId}/members")
    @Transactional
    public ChatView addMembers(@AuthenticationPrincipal Jwt jwt, @PathVariable("chatId") UUID chatId, @Valid @RequestBody AddMembers r) {
        byte[] me = me(jwt);
        byte[] chat = Ids.bytes(chatId);
        requireMember(chat, me);
        List<UUID> current = members(chat);
        List<UUID> adding = r.userIds().stream().distinct().filter(u -> !current.contains(u)).toList();
        if (current.size() + adding.size() > MAX_MEMBERS) {
            throw ApiException.badRequest("too_many_members");
        }
        requireFriends(me, adding);
        Long last = jdbc.queryForObject("SELECT COALESCE(MAX(seq), 0) FROM chat_messages WHERE chat_id = ?", Long.class, (Object) chat);
        for (UUID u : adding) {
            jdbc.update("INSERT INTO chat_members (chat_id, user_id, joined_at, read_seq) VALUES (?, ?, ?, ?)", chat, Ids.bytes(u), now(), last);
        }
        return chats(me, List.of(chat)).get(0);
    }

    /** Removes someone from a chat (any member may), or leaves it (my own id). An empty chat is deleted. */
    @DeleteMapping("/v1/chats/{chatId}/members/{userId}")
    @Transactional
    public Map<String, String> removeMember(@AuthenticationPrincipal Jwt jwt, @PathVariable("chatId") UUID chatId,
            @PathVariable("userId") UUID userId) {
        byte[] me = me(jwt);
        byte[] chat = Ids.bytes(chatId);
        requireMember(chat, me);
        if (jdbc.update("DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?", chat, Ids.bytes(userId)) != 1) {
            throw ApiException.notFound();
        }
        if (members(chat).isEmpty()) {
            MediaSweeper.release(jdbc, "message_id IN (SELECT id FROM chat_messages WHERE chat_id = ?)", (Object) chat);
            jdbc.update("DELETE FROM chats WHERE id = ?", (Object) chat);
        }
        return Map.of("status", "removed");
    }

    // ---------- messages ----------

    /** Messages after `after` (oldest first), or the latest page before `before` (also oldest first). */
    @GetMapping("/v1/chats/{chatId}/messages")
    public List<MessageView> messages(@AuthenticationPrincipal Jwt jwt, @PathVariable("chatId") UUID chatId,
            @RequestParam(value = "after", required = false) Long after, @RequestParam(value = "before", required = false) Long before,
            @RequestParam(value = "limit", defaultValue = "100") int limit) {
        byte[] me = me(jwt);
        byte[] chat = Ids.bytes(chatId);
        requireMember(chat, me);
        int n = Math.max(1, Math.min(limit, 200));
        if (after != null) {
            return messages("WHERE chat_id = ? AND seq > ?" + NOT_BLOCKED + " ORDER BY seq LIMIT ?", chat, after, me, n);
        }
        List<MessageView> page = new ArrayList<>(messages("WHERE chat_id = ? AND seq < ?" + NOT_BLOCKED + " ORDER BY seq DESC LIMIT ?",
                chat, before == null ? Long.MAX_VALUE : before, me, n));
        Collections.reverse(page);
        return page;
    }

    public record NewMessage(@NotNull @Size(max = 4 * MAX_CHARS) String text,
            @Size(max = Attachments.MAX_PER_ITEM) List<Attachments.@Valid NewAttachment> media) {}

    @PostMapping("/v1/chats/{chatId}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public MessageView send(@AuthenticationPrincipal Jwt jwt, @PathVariable("chatId") UUID chatId, @Valid @RequestBody NewMessage r) {
        byte[] me = me(jwt);
        byte[] chat = Ids.bytes(chatId);
        requireMember(chat, me);
        if (!limiter.tryAcquire("messages", me, 300, 60_000)) {
            throw ApiException.rateLimited();
        }
        List<Attachments.NewAttachment> media = r.media() == null ? List.of() : r.media();
        String text = r.text() == null ? "" : r.text().strip();
        int chars = text.codePointCount(0, text.length());
        if (chars > MAX_CHARS || (chars == 0 && media.isEmpty())) {
            throw ApiException.badRequest("invalid_text");
        }
        UUID id = Ids.newId();
        jdbc.update("INSERT INTO chat_messages (id, chat_id, sender_id, body, created_at) VALUES (?, ?, ?, ?, ?)", Ids.bytes(id), chat, me,
                text, now());
        attachments.attach(me, null, Ids.bytes(id), media);
        MessageView sent = messages("WHERE id = ?", (Object) Ids.bytes(id)).get(0);
        jdbc.update("UPDATE chat_members SET read_seq = GREATEST(read_seq, ?) WHERE chat_id = ? AND user_id = ?", sent.seq(), chat, me);
        List<UUID> everyone = members(chat);
        notifier.changed(everyone);
        for (UUID u : everyone) {
            notifier.message(Ids.bytes(u), me, chatId);
        }
        return sent;
    }

    /** Deletes one of my messages for everyone in the chat. */
    @DeleteMapping("/v1/chats/{chatId}/messages/{messageId}")
    @Transactional
    public Map<String, String> deleteMessage(@AuthenticationPrincipal Jwt jwt, @PathVariable("chatId") UUID chatId,
            @PathVariable("messageId") UUID messageId) {
        byte[] me = me(jwt);
        byte[] id = Ids.bytes(messageId);
        if (jdbc.update("DELETE FROM chat_messages WHERE id = ? AND chat_id = ? AND sender_id = ?", id, Ids.bytes(chatId), me) != 1) {
            throw ApiException.notFound();
        }
        MediaSweeper.release(jdbc, "message_id = ?", (Object) id);
        notifier.changed(members(Ids.bytes(chatId)));
        return Map.of("status", "deleted");
    }

    public record Read(@Min(0) long seq) {}

    @PostMapping("/v1/chats/{chatId}/read")
    public Map<String, Object> markRead(@AuthenticationPrincipal Jwt jwt, @PathVariable("chatId") UUID chatId, @Valid @RequestBody Read r) {
        byte[] me = me(jwt);
        byte[] chat = Ids.bytes(chatId);
        requireMember(chat, me);
        jdbc.update("UPDATE chat_members SET read_seq = GREATEST(read_seq, ?) WHERE chat_id = ? AND user_id = ?", r.seq(), chat, me);
        notifier.changed(me);
        return Map.of("status", "read");
    }
}
