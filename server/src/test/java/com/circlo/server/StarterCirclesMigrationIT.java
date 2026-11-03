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
 * V26 moves accounts made before 2026-11-03 to the new starter circles without changing who sees what: an untouched
 * Close Friends (1) and Family (2) swap places, members and posts included, Kids becomes School, and Acquaintances is
 * added. Circles their owner renamed are left alone.
 */
class StarterCirclesMigrationIT extends IntegrationTest {

    @Autowired
    private JdbcTemplate jdbc;

    private final Timestamp now = Timestamp.from(Instant.now());

    private byte[] user(String username, String status) {
        byte[] id = Ids.bytes(UUID.randomUUID());
        jdbc.update("INSERT INTO users (id, name, username, email, password_hash, status, created_at) VALUES (?, NULL, ?, ?, 'x', ?, ?)",
                id, username, username + "@example.test", status, now);
        return id;
    }

    private void circle(byte[] owner, int id, String name) {
        jdbc.update("INSERT INTO circles (owner_id, id, name, created_at) VALUES (?, ?, ?, ?)", owner, id, name, now);
    }

    private void member(byte[] owner, int circle, byte[] member) {
        jdbc.update("INSERT INTO circle_members (owner_id, circle_id, member_id) VALUES (?, ?, ?)", owner, circle, member);
    }

    private byte[] post(byte[] author, int... circles) {
        byte[] id = Ids.bytes(UUID.randomUUID());
        jdbc.update("INSERT INTO posts (id, author_id, body, audience, created_at) VALUES (?, ?, 'hi', 'circles', ?)", id, author, now);
        for (int c : circles) {
            jdbc.update("INSERT INTO post_circles (post_id, circle_id) VALUES (?, ?)", id, c);
        }
        return id;
    }

    private List<String> names(byte[] owner) {
        return jdbc.queryForList("SELECT CONCAT(id, ' ', name) FROM circles WHERE owner_id = ? ORDER BY id", String.class, (Object) owner);
    }

    private List<UUID> members(byte[] owner, int circle) {
        return jdbc.queryForList("SELECT member_id FROM circle_members WHERE owner_id = ? AND circle_id = ? ORDER BY member_id",
                byte[].class, owner, circle).stream().map(Ids::uuid).toList();
    }

    private List<Integer> circlesOf(byte[] post) {
        return jdbc.queryForList("SELECT circle_id FROM post_circles WHERE post_id = ? ORDER BY circle_id", Integer.class, (Object) post);
    }

    @Test
    void movesOldStarterCirclesToTheNewOnesKeepingWhoSeesWhat() {
        flyway.clean();
        Flyway.configure().configuration(flyway.getConfiguration()).target("25").load().migrate();

        byte[] friendA = user("mig_friend_a", "active");
        byte[] friendB = user("mig_friend_b", "active");
        byte[] friendC = user("mig_friend_c", "active");

        // Untouched starters, with people and posts in them.
        byte[] old = user("mig_old", "active");
        circle(old, 1, "Close Friends");
        circle(old, 2, "Family");
        circle(old, 3, "Kids");
        circle(old, 4, "Work");
        member(old, 1, friendA);
        member(old, 2, friendB);
        member(old, 1, friendC);
        member(old, 2, friendC);
        member(old, 3, friendB);
        byte[] toCloseFriends = post(old, 1);
        byte[] toFamily = post(old, 2);
        byte[] toBoth = post(old, 1, 2, 4);

        // Renamed and added circles stay as their owner left them; Acquaintances takes the lowest free id.
        byte[] renamed = user("mig_renamed", "active");
        circle(renamed, 1, "Besties");
        circle(renamed, 2, "Family");
        circle(renamed, 3, "Toddlers");
        circle(renamed, 5, "Gym");
        member(renamed, 1, friendA);
        byte[] renamedPost = post(renamed, 1);

        // Eight circles already: no room for Acquaintances.
        byte[] full = user("mig_full", "active");
        for (int i = 1; i <= 8; i++) {
            circle(full, i, "C" + i);
        }

        // Not signed up yet: gets the new starters when they verify.
        byte[] pending = user("mig_pending", "pending");

        flyway.migrate();

        assertThat(names(old)).containsExactly("1 Family", "2 Close Friends", "3 School", "4 Work", "5 Acquaintances");
        assertThat(members(old, 1)).containsExactlyInAnyOrder(Ids.uuid(friendB), Ids.uuid(friendC));
        assertThat(members(old, 2)).containsExactlyInAnyOrder(Ids.uuid(friendA), Ids.uuid(friendC));
        assertThat(members(old, 3)).containsExactly(Ids.uuid(friendB));
        assertThat(circlesOf(toCloseFriends)).containsExactly(2);
        assertThat(circlesOf(toFamily)).containsExactly(1);
        assertThat(circlesOf(toBoth)).containsExactly(1, 2, 4);

        assertThat(names(renamed)).containsExactly("1 Besties", "2 Family", "3 Toddlers", "4 Acquaintances", "5 Gym");
        assertThat(members(renamed, 1)).containsExactly(Ids.uuid(friendA));
        assertThat(circlesOf(renamedPost)).containsExactly(1);

        assertThat(names(full)).hasSize(8).doesNotContain("5 Acquaintances");
        assertThat(names(pending)).isEmpty();
    }
}
