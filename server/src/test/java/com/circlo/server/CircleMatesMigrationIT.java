package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.circlo.server.web.Ids;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * V32 (owner decision 2026-11-20): existing circles named Family or Close Friends let their people see each other;
 * every other circle starts off. Everyone is shown to their circle mates until they turn it off.
 */
class CircleMatesMigrationIT extends IntegrationTest {

    @Autowired
    private JdbcTemplate jdbc;

    private final Timestamp now = Timestamp.from(Instant.now());

    @Test
    void familyAndCloseFriendsStartOnEverythingElseOff() {
        flyway.clean();
        Flyway.configure().configuration(flyway.getConfiguration()).target("31").load().migrate();

        byte[] owner = Ids.bytes(UUID.randomUUID());
        jdbc.update("INSERT INTO users (id, name, username, email, password_hash, status, created_at) VALUES (?, NULL, 'mig_cm', 'mig_cm@example.test', 'x', 'active', ?)",
                owner, now);
        String[] names = {"Family", "Besties", "Work", "close friends"};
        for (int i = 0; i < names.length; i++) {
            jdbc.update("INSERT INTO circles (owner_id, id, name, created_at) VALUES (?, ?, ?, ?)", owner, i + 1, names[i], now);
        }

        flyway.migrate();

        assertThat(jdbc.queryForList("SELECT CONCAT(name, '=', members_visible) FROM circles WHERE owner_id = ? ORDER BY id", String.class, (Object) owner))
                .isEqualTo(List.of("Family=1", "Besties=0", "Work=0", "close friends=1"));
        assertThat(jdbc.queryForObject("SELECT show_in_circles FROM users WHERE id = ?", Boolean.class, (Object) owner)).isTrue();
    }
}
