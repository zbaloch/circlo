package com.halqo.server.posts;

import java.util.Arrays;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Who may see an author's posts at all: the author and accepted friends. Which posts they can decrypt is theirs to know. */
@Component
public class PostAccess {

    private final JdbcTemplate jdbc;

    public PostAccess(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean canRead(byte[] me, byte[] author) {
        return Arrays.equals(me, author) || !jdbc.queryForList(
                "SELECT 1 FROM friendships WHERE status = 'accepted' AND ((user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?))",
                me, author, author, me).isEmpty();
    }

    public Optional<byte[]> authorOf(byte[] postId) {
        return jdbc.query("SELECT author_id FROM posts WHERE id = ?", (rs, i) -> rs.getBytes(1), (Object) postId).stream().findFirst();
    }
}
