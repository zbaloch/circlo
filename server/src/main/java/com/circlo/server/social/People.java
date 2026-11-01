package com.circlo.server.social;

import com.circlo.server.storage.MediaUrlSigner;
import com.circlo.server.web.Ids;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Who is connected to whom, blocks, and the short profile shown next to someone's posts, replies and messages. */
@Component
public class People {

    /** A person as shown on a post, reply, message or list: never their email. */
    public record Person(UUID userId, String name, String username, String avatarUrl) {}

    private final JdbcTemplate jdbc;
    private final MediaUrlSigner signer;

    public People(JdbcTemplate jdbc, MediaUrlSigner signer) {
        this.jdbc = jdbc;
        this.signer = signer;
    }

    /** 'accepted', 'outgoing' (I asked), 'incoming' (they asked), or null. */
    public String relation(byte[] me, byte[] other) {
        List<Object[]> rows = jdbc.query(
                "SELECT user_a, status FROM friendships WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)",
                (rs, i) -> new Object[] {rs.getBytes(1), rs.getString(2)}, me, other, other, me);
        if (rows.isEmpty()) {
            return null;
        }
        if (rows.get(0)[1].equals("accepted")) {
            return "accepted";
        }
        return Arrays.equals((byte[]) rows.get(0)[0], me) ? "outgoing" : "incoming";
    }

    public boolean friends(byte[] me, byte[] other) {
        return "accepted".equals(relation(me, other));
    }

    /** My accepted friends. */
    public Set<UUID> friendIds(byte[] me) {
        Set<UUID> out = new HashSet<>();
        jdbc.query("SELECT IF(user_a = ?, user_b, user_a) FROM friendships WHERE status = 'accepted' AND (user_a = ? OR user_b = ?)",
                rs -> {
                    out.add(Ids.uuid(rs.getBytes(1)));
                }, me, me, me);
        return out;
    }

    /** True if either user blocked the other. */
    public static boolean blockedEitherWay(JdbcTemplate jdbc, byte[] a, byte[] b) {
        return !jdbc.queryForList("SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)",
                a, b, b, a).isEmpty();
    }

    public boolean blockedEitherWay(byte[] a, byte[] b) {
        return blockedEitherWay(jdbc, a, b);
    }

    public boolean isActive(byte[] userId) {
        return !jdbc.queryForList("SELECT 1 FROM users WHERE id = ? AND status = 'active'", (Object) userId).isEmpty();
    }

    /** Short profiles of these (active) users, in one query. */
    public Map<UUID, Person> persons(Collection<UUID> all) {
        List<UUID> ids = all.stream().distinct().toList();
        if (ids.isEmpty()) {
            return Map.of();
        }
        Map<UUID, Person> out = new HashMap<>();
        jdbc.query("SELECT id, COALESCE(name, username), username, avatar_key FROM users WHERE status = 'active' AND id IN ("
                        + String.join(",", Collections.nCopies(ids.size(), "?")) + ")",
                rs -> {
                    UUID id = Ids.uuid(rs.getBytes(1));
                    out.put(id, new Person(id, rs.getString(2), rs.getString(3), signer.url(rs.getString(4))));
                },
                ids.stream().map(Ids::bytes).toArray());
        return out;
    }

    public Person person(UUID id) {
        return persons(List.of(id)).get(id);
    }

    /**
     * Ends any connection between two people: the friendship, each other's circle memberships, and access to earlier
     * circle posts. Used by unfriend, decline and block.
     */
    public void disconnect(byte[] a, byte[] b) {
        jdbc.update("DELETE FROM friendships WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)", a, b, b, a);
        jdbc.update("DELETE FROM circle_members WHERE (owner_id = ? AND member_id = ?) OR (owner_id = ? AND member_id = ?)", a, b, b, a);
        jdbc.update("""
                DELETE pa FROM post_audience pa JOIN posts p ON p.id = pa.post_id
                WHERE (p.author_id = ? AND pa.user_id = ?) OR (p.author_id = ? AND pa.user_id = ?)""", a, b, b, a);
    }
}
