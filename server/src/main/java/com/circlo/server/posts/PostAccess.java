package com.circlo.server.posts;

import com.circlo.server.crypto.CircloCore;
import com.circlo.server.web.Ids;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Who may see an author's posts at all: the author and accepted friends. Which posts they can decrypt is theirs to know. */
@Component
public class PostAccess {

    private final JdbcTemplate jdbc;
    private final CircloCore core;

    public PostAccess(JdbcTemplate jdbc, CircloCore core) {
        this.jdbc = jdbc;
        this.core = core;
    }

    public boolean canRead(byte[] me, byte[] author) {
        return Arrays.equals(me, author) || !jdbc.queryForList(
                "SELECT 1 FROM friendships WHERE status = 'accepted' AND ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))",
                me, author, author, me).isEmpty();
    }

    public Optional<byte[]> authorOf(byte[] postId) {
        return jdbc.query("SELECT author_id FROM posts WHERE id = ?", (rs, i) -> rs.getBytes(1), (Object) postId).stream().findFirst();
    }

    /**
     * Is the caller in this post's audience? They must be the author or a friend, and (for posts with a read-token
     * hash) present the post's read token, which only people who can open the post can derive (CRYPTO.md 13c).
     */
    public boolean inAudience(byte[] me, byte[] postId, byte[] readToken) {
        List<Object[]> rows = jdbc.query("SELECT author_id, read_token_hash FROM posts WHERE id = ?",
                (rs, i) -> new Object[] {rs.getBytes(1), rs.getBytes(2)}, (Object) postId);
        if (rows.isEmpty() || !canRead(me, (byte[]) rows.get(0)[0])) {
            return false;
        }
        byte[] stored = (byte[]) rows.get(0)[1];
        if (stored == null) {
            return true; // created before read tokens existed
        }
        return readToken != null && readToken.length == 32 && MessageDigest.isEqual(stored, core.readTokenHash(readToken));
    }

    /**
     * {@link #inAudience} for many posts at once, in two queries (feed-sized batches; PLAN.md Phase 12 load test).
     * Returns the ids of the posts the caller may see interactions on.
     */
    public Set<UUID> inAudience(byte[] me, Map<UUID, byte[]> readTokens) {
        if (readTokens.isEmpty()) {
            return Set.of();
        }
        String marks = String.join(",", Collections.nCopies(readTokens.size(), "?"));
        List<Object[]> posts = jdbc.query("SELECT id, author_id, read_token_hash FROM posts WHERE id IN (" + marks + ")",
                (rs, i) -> new Object[] {Ids.uuid(rs.getBytes(1)), rs.getBytes(2), rs.getBytes(3)},
                readTokens.keySet().stream().map(Ids::bytes).toArray());
        Set<UUID> friends = new HashSet<>();
        jdbc.query("SELECT IF(user_a = ?, user_b, user_a) FROM friendships WHERE status = 'accepted' AND (user_a = ? OR user_b = ?)",
                rs -> {
                    friends.add(Ids.uuid(rs.getBytes(1)));
                }, me, me, me);
        Set<UUID> out = new HashSet<>();
        for (Object[] p : posts) {
            byte[] author = (byte[]) p[1];
            if (!Arrays.equals(me, author) && !friends.contains(Ids.uuid(author))) {
                continue;
            }
            byte[] stored = (byte[]) p[2];
            byte[] token = readTokens.get((UUID) p[0]);
            if (stored == null || (token != null && token.length == 32 && MessageDigest.isEqual(stored, core.readTokenHash(token)))) {
                out.add((UUID) p[0]);
            }
        }
        return out;
    }

    /** Decodes the X-Circlo-Read-Token header (base64); null if missing or malformed. */
    public static byte[] tokenFromHeader(String header) {
        if (header == null || header.isBlank()) {
            return null;
        }
        try {
            return Base64.getDecoder().decode(header.trim());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
