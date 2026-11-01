package com.circlo.server.social;

import com.circlo.server.auth.TokenService;
import com.circlo.server.config.ServerSecrets;
import com.circlo.server.notify.Notifier;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
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
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
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
 * Everyone has one invite link that stays the same until they reset it, and opening it connects at once (owner decision
 * 2026-11-01). One-time invites from before still work until they expire.
 */
@RestController
public class SocialController {

    static final Duration INVITE_TTL = Duration.ofDays(7);
    static final int MAX_ACTIVE_INVITES = 20;
    /** If a link leaks, at most this many people can join through it in a day. */
    static final int MAX_LINK_JOINS_PER_DAY = 20;

    private final JdbcTemplate jdbc;
    private final People people;
    private final String inviteBase;
    private final Notifier notifier;
    private final SecretKeySpec linkKey;

    public SocialController(JdbcTemplate jdbc, People people, Notifier notifier, ServerSecrets secrets,
            @Value("${circlo.invite-base:https://www.hellocirclo.com/i/}") String inviteBase) {
        this.jdbc = jdbc;
        this.people = people;
        this.inviteBase = inviteBase;
        this.notifier = notifier;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secrets.jwtKey(), "HmacSHA256"));
            linkKey = new SecretKeySpec(mac.doFinal("circlo.invite-link.v1".getBytes(StandardCharsets.UTF_8)), "HmacSHA256");
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
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

    public record InviteLink(String token, String link) {}

    /**
     * My invite link (made the first time I ask). The token is derived from a stored nonce with a server key, so it
     * isn't stored; if that key changes, the link changes too, as if reset.
     */
    @GetMapping("/v1/invites/link")
    @Transactional
    public InviteLink inviteLink(@AuthenticationPrincipal Jwt jwt) {
        byte[] me = me(jwt);
        List<byte[][]> rows = jdbc.query("SELECT nonce, token_hash FROM invite_links WHERE user_id = ? FOR UPDATE",
                (rs, i) -> new byte[][] {rs.getBytes(1), rs.getBytes(2)}, (Object) me);
        if (rows.isEmpty()) {
            return newLink(me);
        }
        String token = linkToken(me, rows.get(0)[0]);
        if (!Arrays.equals(inviteHash(token), rows.get(0)[1])) {
            jdbc.update("UPDATE invite_links SET token_hash = ? WHERE user_id = ?", inviteHash(token), me);
        }
        return new InviteLink(token, inviteBase + token);
    }

    /** A new link: the old one (and its QR code) stops working. People who joined stay connected. */
    @PostMapping("/v1/invites/link/reset")
    @Transactional
    public InviteLink resetInviteLink(@AuthenticationPrincipal Jwt jwt) {
        return newLink(me(jwt));
    }

    private InviteLink newLink(byte[] me) {
        byte[] nonce = Ids.random(16);
        String token = linkToken(me, nonce);
        jdbc.update("""
                INSERT INTO invite_links (user_id, nonce, token_hash, created_at) VALUES (?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE nonce = VALUES(nonce), token_hash = VALUES(token_hash), created_at = VALUES(created_at)""",
                me, nonce, inviteHash(token), now());
        return new InviteLink(token, inviteBase + token);
    }

    private String linkToken(byte[] user, byte[] nonce) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(linkKey);
            mac.update(user);
            return Base64.getUrlEncoder().withoutPadding().encodeToString(Arrays.copyOf(mac.doFinal(nonce), 24));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Whose link this is, or null if it isn't a current link. */
    private byte[] linkOwner(byte[] hash) {
        List<byte[]> rows = jdbc.query("SELECT user_id FROM invite_links WHERE token_hash = ?", (rs, i) -> rs.getBytes(1), (Object) hash);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /**
     * Whether I may use this person's invite: they're active and neither of us blocked the other; for their link, also
     * that they didn't remove me (a one-time invite is sent on purpose, so it works).
     */
    private boolean mayUse(byte[] owner, byte[] me, boolean link) {
        return people.isActive(owner) && !people.blockedEitherWay(owner, me) && (!link
                || jdbc.queryForList("SELECT 1 FROM invite_link_exclusions WHERE owner_id = ? AND user_id = ?", owner, me).isEmpty());
    }

    private byte[] usableOwner(byte[] owner, byte[] me, boolean link) {
        if (owner == null || !mayUse(owner, me, link)) {
            throw ApiException.notFound();
        }
        if (Arrays.equals(owner, me)) {
            throw ApiException.badRequest("own_invite");
        }
        return owner;
    }

    public record Invite(String token, String link, Instant expiresAt) {}

    /** A single-use invite link (7 days), from before links were permanent; kept for older apps. Only the token's hash is stored. */
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

    /** Who an invite is from, so the app can ask which circles to put them in. Changes nothing. */
    @PostMapping("/v1/invites/preview")
    public People.Person preview(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody RedeemInvite r) {
        byte[] me = me(jwt);
        byte[] hash = inviteHash(r.token());
        byte[] owner = linkOwner(hash);
        if (owner != null) {
            return people.person(Ids.uuid(usableOwner(owner, me, true)));
        }
        List<byte[]> once = jdbc.query("SELECT inviter_id FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
                (rs, i) -> rs.getBytes(1), hash, now());
        return people.person(Ids.uuid(usableOwner(once.isEmpty() ? null : once.get(0), me, false)));
    }

    public record JoinInvite(@NotNull @Pattern(regexp = "[A-Za-z0-9_-]{16,64}") String token,
            @Size(max = CircleController.MAX_CIRCLES) List<Integer> circles) {}

    public record Joined(UUID userId, String status) {}

    /**
     * Uses an invite, putting its owner in my `circles` (they aren't told which). Someone's link connects us at once,
     * and they're told I joined (I'm in their Everyone until they choose circles). A one-time invite sends a request, as
     * before.
     */
    @PostMapping("/v1/invites/join")
    @Transactional
    public Joined join(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody JoinInvite r) {
        byte[] me = me(jwt);
        byte[] hash = inviteHash(r.token());
        List<Integer> circles = r.circles() == null ? List.of() : r.circles();
        byte[] owner = linkOwner(hash);
        if (owner != null) {
            joinLink(me, usableOwner(owner, me, true), circles);
            return new Joined(Ids.uuid(owner), "accepted");
        }
        byte[] inviter = redeemOnce(me, hash);
        sendRequest(me, inviter, circles);
        return new Joined(Ids.uuid(inviter), "outgoing");
    }

    private void joinLink(byte[] me, byte[] owner, List<Integer> circles) {
        if ("accepted".equals(people.relation(me, owner))) {
            throw ApiException.conflict("already_connected");
        }
        Integer today = jdbc.queryForObject("SELECT COUNT(*) FROM friendships WHERE user_b = ? AND via_link = TRUE AND created_at > ?",
                Integer.class, owner, Timestamp.from(Instant.now().minus(Duration.ofDays(1))));
        if (today != null && today >= MAX_LINK_JOINS_PER_DAY) {
            throw ApiException.rateLimited();
        }
        // A request either way is replaced: opening their link says yes. Circles either of us already chose are kept.
        jdbc.update("DELETE FROM friendships WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)", me, owner, owner, me);
        jdbc.update("INSERT INTO friendships (id, user_a, user_b, status, created_at, via_link) VALUES (?, ?, ?, 'accepted', ?, TRUE)",
                Ids.bytes(Ids.newId()), me, owner, now());
        jdbc.update("DELETE FROM invite_link_exclusions WHERE owner_id = ? AND user_id = ?", me, owner);
        CircleController.setMemberships(jdbc, me, owner, circles);
        notifier.changed(owner, me);
        notifier.joined(owner, me);
    }

    /** Marks a one-time invite used by me; returns who sent it. */
    private byte[] redeemOnce(byte[] me, byte[] hash) {
        List<byte[]> inviter = jdbc.query(
                "SELECT inviter_id FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? FOR UPDATE",
                (rs, i) -> rs.getBytes(1), hash, now());
        byte[] owner = usableOwner(inviter.isEmpty() ? null : inviter.get(0), me, false);
        jdbc.update("UPDATE invites SET used_at = ?, redeemed_by = ? WHERE token_hash = ?", now(), me, hash);
        return owner;
    }

    /**
     * For older apps, which redeem and then send a request: returns who sent it. Someone's link connects us here
     * already (the request that follows is told we're connected).
     */
    @PostMapping("/v1/invites/redeem")
    @Transactional
    public People.Person redeem(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody RedeemInvite r) {
        byte[] me = me(jwt);
        byte[] hash = inviteHash(r.token());
        byte[] owner = linkOwner(hash);
        if (owner != null) {
            usableOwner(owner, me, true);
            if (!"accepted".equals(people.relation(me, owner))) {
                joinLink(me, owner, List.of());
            }
            return people.person(Ids.uuid(owner));
        }
        return people.person(Ids.uuid(redeemOnce(me, hash)));
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
        if (people.relation(me, to) != null) {
            throw ApiException.conflict("already_connected");
        }
        if (jdbc.queryForList("SELECT 1 FROM invites WHERE inviter_id = ? AND redeemed_by = ?", to, me).isEmpty()) {
            throw ApiException.forbidden();
        }
        sendRequest(me, to, r.circles());
        return Map.of("status", "outgoing");
    }

    private void sendRequest(byte[] me, byte[] to, List<Integer> circles) {
        if (people.relation(me, to) != null) {
            throw ApiException.conflict("already_connected");
        }
        jdbc.update("INSERT INTO friendships (id, user_a, user_b, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
                Ids.bytes(Ids.newId()), me, to, now());
        CircleController.setMemberships(jdbc, me, to, circles);
        notifier.changed(to);
        notifier.request(to, me);
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
        jdbc.update("DELETE FROM invite_link_exclusions WHERE owner_id = ? AND user_id = ?", me, other);
        CircleController.setMemberships(jdbc, me, other, a == null ? List.of() : a.circles());
        notifier.changed(other);
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
        exclude(me, other);
        return Map.of("status", "declined");
    }

    /**
     * Unfriends (or cancels my request). They lose access to everything I post from now on, and to earlier circle posts,
     * and can't come back through my invite link.
     */
    @DeleteMapping("/v1/friends/{userId}")
    @Transactional
    public Map<String, String> unfriend(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId) {
        byte[] me = me(jwt);
        byte[] other = Ids.bytes(userId);
        String relation = people.relation(me, other);
        if (relation == null) {
            throw ApiException.notFound();
        }
        people.disconnect(me, other);
        if (!"outgoing".equals(relation)) {
            exclude(me, other);
        }
        return Map.of("status", "removed");
    }

    /** Someone I removed or turned down: my invite link no longer works for them. */
    private void exclude(byte[] me, byte[] other) {
        jdbc.update("INSERT IGNORE INTO invite_link_exclusions (owner_id, user_id) VALUES (?, ?)", me, other);
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
