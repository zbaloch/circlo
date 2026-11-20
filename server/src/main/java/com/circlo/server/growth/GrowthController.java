package com.circlo.server.growth;

import com.circlo.server.auth.TokenService;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Growth totals for Circlo's admins (owner request 2026-11-20): per day (UTC) for the last 30 days, how many people
 * signed up, joined through an invite, connected, posted and replied, and the running totals. Only counts, never who;
 * nothing new is recorded for them: they're counted from rows that exist anyway, so deleted accounts and posts drop
 * out of past days too. To anyone who isn't an admin the endpoint doesn't exist (404).
 */
@RestController
public class GrowthController {

    static final int DAYS = 30;

    public record Day(String date, int signups, int inviteJoins, int connections, int posts, int replies) {}

    public record Totals(int people, int connections, int posts) {}

    public record Growth(List<Day> days, Totals totals) {}

    private final JdbcTemplate jdbc;
    private final Admins admins;

    public GrowthController(JdbcTemplate jdbc, Admins admins) {
        this.jdbc = jdbc;
        this.admins = admins;
    }

    @GetMapping("/v1/admin/growth")
    public Growth growth(@AuthenticationPrincipal Jwt jwt) {
        if (!admins.user(Ids.bytes(TokenService.userOf(jwt)))) {
            throw ApiException.notFound();
        }
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        LocalDate first = today.minusDays(DAYS - 1);
        Timestamp since = Timestamp.from(first.atStartOfDay(ZoneOffset.UTC).toInstant());

        Map<LocalDate, Integer> signups = perDay("SELECT created_at FROM users WHERE status = 'active' AND created_at >= ?", since);
        // A one-time invite used, or someone's link opened (that connects at once).
        Map<LocalDate, Integer> joins = perDay("SELECT used_at FROM invites WHERE used_at >= ?", since);
        merge(joins, perDay("SELECT created_at FROM friendships WHERE via_link AND created_at >= ?", since));
        // Requests accepted before V28 have no accepted_at: they're older than this page anyway.
        Map<LocalDate, Integer> connections = perDay(
                "SELECT COALESCE(accepted_at, created_at) FROM friendships WHERE status = 'accepted' AND COALESCE(accepted_at, created_at) >= ?", since);
        Map<LocalDate, Integer> posts = perDay("SELECT created_at FROM posts WHERE created_at >= ?", since);
        Map<LocalDate, Integer> replies = perDay("SELECT created_at FROM post_replies WHERE created_at >= ?", since);

        List<Day> days = new ArrayList<>();
        for (LocalDate d = today; !d.isBefore(first); d = d.minusDays(1)) {
            days.add(new Day(d.toString(), signups.getOrDefault(d, 0), joins.getOrDefault(d, 0), connections.getOrDefault(d, 0),
                    posts.getOrDefault(d, 0), replies.getOrDefault(d, 0)));
        }
        Totals totals = new Totals(count("SELECT COUNT(*) FROM users WHERE status = 'active'"),
                count("SELECT COUNT(*) FROM friendships WHERE status = 'accepted'"), count("SELECT COUNT(*) FROM posts"));
        return new Growth(days, totals);
    }

    /** Rows per UTC day. Timestamps are read back as instants, so the server's own time zone doesn't matter. */
    private Map<LocalDate, Integer> perDay(String sql, Timestamp since) {
        Map<LocalDate, Integer> out = new HashMap<>();
        jdbc.query(sql, rs -> {
            Instant at = rs.getTimestamp(1).toInstant();
            out.merge(LocalDate.ofInstant(at, ZoneOffset.UTC), 1, Integer::sum);
        }, since);
        return out;
    }

    private static void merge(Map<LocalDate, Integer> into, Map<LocalDate, Integer> more) {
        more.forEach((d, n) -> into.merge(d, n, Integer::sum));
    }

    private int count(String sql) {
        Integer n = jdbc.queryForObject(sql, Integer.class);
        return n == null ? 0 : n;
    }
}
