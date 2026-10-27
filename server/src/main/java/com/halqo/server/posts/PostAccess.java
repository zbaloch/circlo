package com.halqo.server.posts;

import com.halqo.server.crypto.HalqoCore;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Who may see an author's posts at all: the author and accepted friends. Which posts they can decrypt is theirs to know. */
@Component
public class PostAccess {

    private final JdbcTemplate jdbc;
    private final HalqoCore core;

    public PostAccess(JdbcTemplate jdbc, HalqoCore core) {
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

    /** Decodes the X-Halqo-Read-Token header (base64); null if missing or malformed. */
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
