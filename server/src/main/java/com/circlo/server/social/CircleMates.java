package com.circlo.server.social;

import com.circlo.server.web.Ids;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * People in the same circle see each other (owner decision 2026-11-20). A friend's "circle mates", as I see them, are
 * the other people in any of their circles that I'm in too, where the owner has switched on "People in this circle can
 * see each other" (Family and Close Friends start on). Only accepted friends of the owner count, people who turned off
 * "Show me to others in the same circles" are left out, and so is anyone either of us blocked. The list never says
 * which circle, and it's sorted by name, so it can't be split into circles either. Circle mates may send each other a
 * friend request.
 */
@Component
public class CircleMates {

    /** A circle mate as I see them: shown as on a post, with how we're connected (null: not yet). */
    public record Mate(UUID userId, String name, String username, String avatarUrl, String relation) {}

    /** True if the owner (`o`) and their person (`p`) are friends: anyone else in a circle is a pending request. */
    private static String accepted(String o, String p) {
        return "EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND ((f.user_a = " + o + " AND f.user_b = " + p
                + ") OR (f.user_a = " + p + " AND f.user_b = " + o + ")))";
    }

    /**
     * `me` (in circle `cm`) and someone else in the same circle (`co`, user `u`), in a circle whose owner switched it
     * on, both friends of the owner, the other person not hidden, and no block between us.
     */
    private static final String SHARED = """
            FROM circle_members cm
            JOIN circles c ON c.owner_id = cm.owner_id AND c.id = cm.circle_id AND c.members_visible
            JOIN circle_members co ON co.owner_id = cm.owner_id AND co.circle_id = cm.circle_id AND co.member_id <> cm.member_id
            JOIN users u ON u.id = co.member_id AND u.status = 'active' AND u.show_in_circles
            JOIN users ou ON ou.id = cm.owner_id AND ou.status = 'active'
            WHERE cm.member_id = ?
              AND %s AND %s
              AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE (b.blocker_id = cm.member_id AND b.blocked_id = co.member_id)
                                                           OR (b.blocker_id = co.member_id AND b.blocked_id = cm.member_id))
            """.formatted(accepted("cm.owner_id", "cm.member_id"), accepted("cm.owner_id", "co.member_id"));

    private final JdbcTemplate jdbc;
    private final People people;

    public CircleMates(JdbcTemplate jdbc, People people) {
        this.jdbc = jdbc;
        this.people = people;
    }

    /** `owner`'s circle mates as `viewer` sees them. The caller checks that the viewer is the owner's friend. */
    public List<Mate> of(byte[] owner, byte[] viewer) {
        List<UUID> ids = jdbc.query("SELECT DISTINCT co.member_id " + SHARED + " AND cm.owner_id = ?",
                (rs, i) -> Ids.uuid(rs.getBytes(1)), viewer, owner);
        if (ids.isEmpty()) {
            return List.of();
        }
        Map<UUID, String> relations = relations(viewer);
        Map<UUID, People.Person> persons = people.persons(ids);
        List<Mate> out = new ArrayList<>();
        for (UUID id : ids) {
            People.Person p = persons.get(id);
            if (p != null) {
                out.add(new Mate(id, p.name(), p.username(), p.avatarUrl(), relations.get(id)));
            }
        }
        out.sort(Comparator.comparing(Mate::name, String.CASE_INSENSITIVE_ORDER).thenComparing(Mate::username));
        return out;
    }

    /** True if `to` appears in `me`'s list on the profile of some friend we share, so I may ask them to connect. */
    public boolean visibleTo(byte[] me, byte[] to) {
        return !jdbc.queryForList("SELECT 1 " + SHARED + " AND co.member_id = ? LIMIT 1", me, to).isEmpty();
    }

    /** How I'm connected to each person I'm connected to at all. */
    private Map<UUID, String> relations(byte[] me) {
        Map<UUID, String> out = new HashMap<>();
        jdbc.query("SELECT user_a, user_b, status FROM friendships WHERE user_a = ? OR user_b = ?",
                rs -> {
                    boolean iAsked = Arrays.equals(rs.getBytes(1), me);
                    String status = rs.getString(3).equals("accepted") ? "accepted" : (iAsked ? "outgoing" : "incoming");
                    out.put(Ids.uuid(iAsked ? rs.getBytes(2) : rs.getBytes(1)), status);
                }, me, me);
        return out;
    }
}
