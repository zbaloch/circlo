package com.circlo.server.social;

import com.circlo.server.auth.TokenService;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Friends: invites (a link or QR code is the only way to connect; there is no search), requests, and profiles. A
 * profile is visible to people you're connected with (friends and pending requests either way), never to strangers.
 */
@RestController
public class SocialController {

    static final Duration INVITE_TTL = Duration.ofDays(7);
    static final int MAX_ACTIVE_INVITES = 20;

    private final JdbcTemplate jdbc;
    private final People people;
    private final String inviteBase;

    public SocialController(JdbcTemplate jdbc, People people,
            @Value("${circlo.invite-base:https://www.hellocirclo.com/i/}") String inviteBase) {
        this.jdbc = jdbc;
        this.people = people;
        this.inviteBase = inviteBase;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(TokenService.userOf(jwt));
    }

    private static Timestamp now() {
        return Timestamp.from(Instant.now());
    }

    static byte[] inviteHash(String token) {
        return TokenService.sha256(("circlo-invite:" + token).getBytes(StandardCharsets.US_ASCII));
    }

    // ---------- invites ----------

    public record Invite(String token, String link, Instant expiresAt) {}

    /** A single-use invite link (7 days). Only the token's hash is stored. */
    @PostMapping("/v1/invites")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Invite createInvite(@AuthenticationPrincipal Jwt jwt) {
        byte[] me = me(jwt);
        Integer active = jdbc.queryForObject(
                "SELECT COUNT(*) FROM invites WHERE inviter_id = ? AND used_at IS NULL AND expires_at > ?", Integer.class, me, now());
        if (active != null && active >= MAX_ACTIVE_INVITES) {
            throw ApiException.conflict("too_many_invites");
        }
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(Ids.random(24));
        Instant expires = Instant.now().plus(INVITE_TTL);
        jdbc.update("INSERT INTO invites (token_hash, inviter_id, expires_at) VALUES (?, ?, ?)", inviteHash(token), me,
                Timestamp.from(expires));
        return new Invite(token, inviteBase + token, expires);
    }

    public record RedeemInvite(@NotNull @Pattern(regexp = "[A-Za-z0-9_-]{16,64}") String token) {}

    /** Single use. Returns who sent it, so the app can ask which circles to put them in before sending the request. */
    @PostMapping("/v1/invites/redeem")
    @Transactional
    public People.Person redeem(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody RedeemInvite r) {
        byte[] me = me(jwt);
        byte[] hash = inviteHash(r.token());
        List<byte[]> inviter = jdbc.query(
                "SELECT inviter_id FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? FOR UPDATE",
                (rs, i) -> rs.getBytes(1), hash, now());
        if (inviter.isEmpty() || !people.isActive(inviter.get(0)) || people.blockedEitherWay(inviter.get(0), me)) {
            throw ApiException.notFound();
        }
        if (Arrays.equals(inviter.get(0), me)) {
            throw ApiException.badRequest("own_invite");
        }
        jdbc.update("UPDATE invites SET used_at = ?, redeemed_by = ? WHERE token_hash = ?", now(), me, hash);
        return people.person(Ids.uuid(inviter.get(0)));
    }

    // ---------- requests and friends ----------

    public record FriendRequest(@NotNull UUID toUserId, @Size(max = CircleController.MAX_CIRCLES) List<Integer> circles) {}

    /** Asks someone whose invite I redeemed to connect, and puts them in my circles (they aren't told which). */
    @PostMapping("/v1/friends/requests")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Map<String, String> request(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody FriendRequest r) {
        byte[] me = me(jwt);
        byte[] to = Ids.bytes(r.toUserId());
        if (Arrays.equals(me, to) || !people.isActive(to) || people.blockedEitherWay(me, to)) {
            throw ApiException.notFound();
        }
        if (jdbc.queryForList("SELECT 1 FROM invites WHERE inviter_id = ? AND redeemed_by = ?", to, me).isEmpty()) {
            throw ApiException.forbidden();
        }
        if (people.relation(me, to) != null) {
            throw ApiException.conflict("already_connected");
        }
        jdbc.update("INSERT INTO friendships (id, user_a, user_b, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
                Ids.bytes(Ids.newId()), me, to, now());
        CircleController.setMemberships(jdbc, me, to, r.circles());
        return Map.of("status", "outgoing");
    }

    public record Accept(@Size(max = CircleController.MAX_CIRCLES) List<Integer> circles) {}

    @PostMapping("/v1/friends/{userId}/accept")
    @Transactional
    public Map<String, String> accept(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId,
            @Valid @RequestBody(required = false) Accept a) {
        byte[] me = me(jwt);
        byte[] other = Ids.bytes(userId);
        if (!"incoming".equals(people.relation(me, other))) {
            throw ApiException.notFound();
        }
        jdbc.update("UPDATE friendships SET status = 'accepted' WHERE user_a = ? AND user_b = ?", other, me);
        CircleController.setMemberships(jdbc, me, other, a == null ? List.of() : a.circles());
        return Map.of("status", "accepted");
    }

    @PostMapping("/v1/friends/{userId}/decline")
    @Transactional
    public Map<String, String> decline(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId) {
        byte[] me = me(jwt);
        byte[] other = Ids.bytes(userId);
        if (!"incoming".equals(people.relation(me, other))) {
            throw ApiException.notFound();
        }
        people.disconnect(me, other);
        return Map.of("status", "declined");
    }

    /** Unfriends (or cancels my request). They lose access to everything I post from now on, and to earlier circle posts. */
    @DeleteMapping("/v1/friends/{userId}")
    @Transactional
    public Map<String, String> unfriend(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId) {
        byte[] me = me(jwt);
        byte[] other = Ids.bytes(userId);
        if (people.relation(me, other) == null) {
            throw ApiException.notFound();
        }
        people.disconnect(me, other);
        return Map.of("status", "removed");
    }

    /** `circles`: which of my circles they're in (mine to know; never shown to them). */
    public record Friend(UUID userId, String status, Instant since, String name, String username, String avatarUrl,
            List<Integer> circles) {}

    @GetMapping("/v1/friends")
    public List<Friend> friends(@AuthenticationPrincipal Jwt jwt) {
        byte[] me = me(jwt);
        record Row(UUID id, String status, Instant since) {}
        List<Row> rows = jdbc.query(
                "SELECT user_a, user_b, status, created_at FROM friendships WHERE user_a = ? OR user_b = ? ORDER BY created_at",
                (rs, i) -> {
                    boolean iAsked = Arrays.equals(rs.getBytes(1), me);
                    String status = rs.getString(3).equals("accepted") ? "accepted" : (iAsked ? "outgoing" : "incoming");
                    return new Row(Ids.uuid(iAsked ? rs.getBytes(2) : rs.getBytes(1)), status, rs.getTimestamp(4).toInstant());
                },
                me, me);
        Map<UUID, People.Person> persons = people.persons(rows.stream().map(Row::id).toList());
        Map<UUID, List<Integer>> circles = new HashMap<>();
        jdbc.query("SELECT member_id, circle_id FROM circle_members WHERE owner_id = ? ORDER BY circle_id",
                rs -> {
                    circles.computeIfAbsent(Ids.uuid(rs.getBytes(1)), k -> new ArrayList<>()).add(rs.getInt(2));
                }, (Object) me);
        return rows.stream().filter(r -> persons.containsKey(r.id())).map(r -> {
            People.Person p = persons.get(r.id());
            return new Friend(r.id(), r.status(), r.since(), p.name(), p.username(), p.avatarUrl(), circles.getOrDefault(r.id(), List.of()));
        }).toList();
    }

    // ---------- profiles ----------

    public record Profile(UUID userId, String name, String username, String bio, String avatarUrl, String relation, int friendCount) {}

    /** Someone's profile: mine, or of a person I'm connected with. Otherwise 404, as if they didn't exist. */
    @GetMapping("/v1/users/{userId}")
    public Profile profile(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId) {
        byte[] me = me(jwt);
        byte[] other = Ids.bytes(userId);
        String relation = Arrays.equals(me, other) ? "me" : people.relation(me, other);
        if (relation == null) {
            throw ApiException.notFound();
        }
        People.Person p = people.person(userId);
        if (p == null) {
            throw ApiException.notFound();
        }
        String bio = jdbc.queryForObject("SELECT bio FROM users WHERE id = ?", String.class, (Object) other);
        return new Profile(userId, p.name(), p.username(), bio, p.avatarUrl(), relation, people.friendIds(other).size());
    }
}
