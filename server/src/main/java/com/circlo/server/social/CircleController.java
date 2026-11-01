package com.circlo.server.social;

import com.circlo.server.auth.TokenService;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * My circles (owner decision 2026-10-29): up to 8, ids 1–8, starting with Close Friends, Family, Kids and Work. A friend
 * can be in any number of them. Circle names and memberships are returned only to their owner and nobody is told
 * when they're added, moved or removed.
 */
@RestController
public class CircleController {

    public static final int MAX_CIRCLES = 8;
    static final List<String> STARTERS = List.of("Close Friends", "Family", "Kids", "Work");

    private final JdbcTemplate jdbc;
    private final People people;

    public CircleController(JdbcTemplate jdbc, People people) {
        this.jdbc = jdbc;
        this.people = people;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(TokenService.userOf(jwt));
    }

    /** The starter circles of a new account. */
    public static void createStarterCircles(JdbcTemplate jdbc, byte[] owner) {
        Timestamp now = Timestamp.from(Instant.now());
        for (int i = 0; i < STARTERS.size(); i++) {
            jdbc.update("INSERT INTO circles (owner_id, id, name, created_at) VALUES (?, ?, ?, ?)", owner, i + 1, STARTERS.get(i), now);
        }
    }

    /** The circle ids `owner` has, from those asked for; unknown ids are dropped. */
    static List<Integer> existing(JdbcTemplate jdbc, byte[] owner, List<Integer> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        Set<Integer> mine = new java.util.HashSet<>(jdbc.queryForList("SELECT id FROM circles WHERE owner_id = ?", Integer.class, (Object) owner));
        return new ArrayList<>(new LinkedHashSet<>(ids)).stream().filter(mine::contains).sorted().toList();
    }

    /** Replaces the circles `member` is in among `owner`'s. Silent: nobody is told. */
    static void setMemberships(JdbcTemplate jdbc, byte[] owner, byte[] member, List<Integer> ids) {
        jdbc.update("DELETE FROM circle_members WHERE owner_id = ? AND member_id = ?", owner, member);
        for (int id : existing(jdbc, owner, ids)) {
            jdbc.update("INSERT INTO circle_members (owner_id, circle_id, member_id) VALUES (?, ?, ?)", owner, id, member);
        }
    }

    public record Circle(int id, String name, List<UUID> members) {}

    @GetMapping("/v1/circles")
    public List<Circle> circles(@AuthenticationPrincipal Jwt jwt) {
        byte[] me = me(jwt);
        Map<Integer, Circle> out = new LinkedHashMap<>();
        jdbc.query("SELECT id, name FROM circles WHERE owner_id = ? ORDER BY id",
                rs -> {
                    out.put(rs.getInt(1), new Circle(rs.getInt(1), rs.getString(2), new ArrayList<>()));
                }, (Object) me);
        jdbc.query("SELECT circle_id, member_id FROM circle_members WHERE owner_id = ? ORDER BY circle_id",
                rs -> {
                    Circle c = out.get(rs.getInt(1));
                    if (c != null) {
                        c.members().add(Ids.uuid(rs.getBytes(2)));
                    }
                }, (Object) me);
        return List.copyOf(out.values());
    }

    public record CircleName(@NotNull @Size(min = 1, max = 100) String name) {
        String clean() {
            String n = name.strip();
            if (n.isEmpty() || n.codePointCount(0, n.length()) > 40) {
                throw ApiException.badRequest("invalid_circle_name");
            }
            return n;
        }
    }

    @PostMapping("/v1/circles")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Circle create(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody CircleName r) {
        byte[] me = me(jwt);
        Set<Integer> used = new java.util.HashSet<>(jdbc.queryForList("SELECT id FROM circles WHERE owner_id = ? FOR UPDATE", Integer.class, (Object) me));
        for (int id = 1; id <= MAX_CIRCLES; id++) {
            if (!used.contains(id)) {
                jdbc.update("INSERT INTO circles (owner_id, id, name, created_at) VALUES (?, ?, ?, ?)", me, id, r.clean(),
                        Timestamp.from(Instant.now()));
                return new Circle(id, r.clean(), List.of());
            }
        }
        throw ApiException.conflict("too_many_circles");
    }

    @PutMapping("/v1/circles/{id}")
    public Map<String, String> rename(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") int id, @Valid @RequestBody CircleName r) {
        if (jdbc.update("UPDATE circles SET name = ? WHERE owner_id = ? AND id = ?", r.clean(), me(jwt), id) != 1) {
            throw ApiException.notFound();
        }
        return Map.of("status", "renamed");
    }

    /**
     * Deletes a circle and its memberships. Posts shared with it are no longer shared with it: ones shared only with it
     * are left to me alone. A new circle can reuse the id without inheriting anything.
     */
    @DeleteMapping("/v1/circles/{id}")
    @Transactional
    public Map<String, String> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") int id) {
        byte[] me = me(jwt);
        if (jdbc.update("DELETE FROM circles WHERE owner_id = ? AND id = ?", me, id) != 1) {
            throw ApiException.notFound();
        }
        jdbc.update("DELETE pc FROM post_circles pc JOIN posts p ON p.id = pc.post_id WHERE p.author_id = ? AND pc.circle_id = ?", me, id);
        return Map.of("status", "deleted");
    }

    public record Memberships(@NotNull @Size(max = MAX_CIRCLES) List<Integer> circles) {}

    /** Sets which of my circles a friend (or someone I've asked) is in. */
    @PutMapping("/v1/friends/{userId}/circles")
    @Transactional
    public Map<String, Object> setCircles(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId,
            @Valid @RequestBody Memberships r) {
        byte[] me = me(jwt);
        byte[] other = Ids.bytes(userId);
        String rel = people.relation(me, other);
        if (!"accepted".equals(rel) && !"outgoing".equals(rel)) {
            throw ApiException.notFound();
        }
        setMemberships(jdbc, me, other, r.circles());
        return Map.of("circles", existing(jdbc, me, r.circles()));
    }
}
