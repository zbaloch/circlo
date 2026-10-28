package com.circlo.server.social;

import com.circlo.server.crypto.CircloCore;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Friends: invites (the only way to connect; there is no search), requests, friend key payloads, epochs, encrypted profiles and the
 * encrypted address book. The server relays ciphertext and enforces who may send what to whom; it never sees names,
 * profiles, circle numbers or keys.
 */
@RestController
public class SocialController {

    /** Friend payload version 2 (CRYPTO.md 8.3): 192 bytes for every friend, whatever the circle or membership. */
    static final int PAYLOAD_LEN = 192;
    static final Duration INVITE_TTL = Duration.ofDays(7);
    static final int MAX_ACTIVE_INVITES = 20;

    private final JdbcTemplate jdbc;
    private final CircloCore core;

    private final com.circlo.server.push.PushService push;

    public SocialController(JdbcTemplate jdbc, CircloCore core, com.circlo.server.push.PushService push) {
        this.jdbc = jdbc;
        this.core = core;
        this.push = push;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(UUID.fromString(jwt.getSubject()));
    }

    private static Timestamp now() {
        return Timestamp.from(Instant.now());
    }

    public record Identity(byte[] x25519Pub, byte[] ed25519Pub, byte[] signature, int version) {}

    public record UserWithIdentity(UUID userId, Identity identity) {}

    private Identity identityOf(byte[] userId) {
        return jdbc.query("SELECT x25519_pub, ed25519_pub, signature, version FROM identity_keys WHERE user_id = ?",
                        (rs, i) -> new Identity(rs.getBytes(1), rs.getBytes(2), rs.getBytes(3), rs.getInt(4)), (Object) userId)
                .stream().findFirst().orElseThrow(ApiException::notFound);
    }

    private boolean isActive(byte[] userId) {
        return !jdbc.queryForList("SELECT 1 FROM users WHERE id = ? AND status = 'active'", userId).isEmpty();
    }

    /** 'outgoing' (I asked), 'incoming' (they asked), 'accepted', or null. */
    private String relation(byte[] me, byte[] other) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT user_a, status FROM friendships WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)",
                me, other, other, me);
        if (rows.isEmpty()) {
            return null;
        }
        String status = (String) rows.get(0).get("status");
        if (status.equals("accepted")) {
            return "accepted";
        }
        if (status.equals("blocked")) {
            return "blocked";
        }
        return java.util.Arrays.equals((byte[]) rows.get(0).get("user_a"), me) ? "outgoing" : "incoming";
    }

    // ---------- invites ----------

    public record CreateInvite(@NotNull @Size(min = 32, max = 32) byte[] tokenHash) {}

    public record InviteView(Instant expiresAt) {}

    /** The client generates the token; the server only ever stores its hash (CRYPTO.md section 12). */
    @PostMapping("/v1/invites")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public InviteView createInvite(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody CreateInvite c) {
        byte[] me = me(jwt);
        Integer active = jdbc.queryForObject(
                "SELECT COUNT(*) FROM invites WHERE inviter_id = ? AND used_at IS NULL AND expires_at > ?", Integer.class, me, now());
        if (active != null && active >= MAX_ACTIVE_INVITES) {
            throw ApiException.conflict("too_many_invites");
        }
        Instant expires = Instant.now().plus(INVITE_TTL);
        jdbc.update("INSERT INTO invites (token_hash, inviter_id, expires_at) VALUES (?, ?, ?)", c.tokenHash(), me,
                Timestamp.from(expires));
        return new InviteView(expires);
    }

    public record RedeemInvite(@NotNull @Size(min = 32, max = 32) byte[] token) {}

    /** Single use. Returns the inviter's identity; the app checks it against the fingerprint in the link. */
    @PostMapping("/v1/invites/redeem")
    @Transactional
    public UserWithIdentity redeem(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody RedeemInvite r) {
        byte[] me = me(jwt);
        byte[] hash = core.inviteTokenHash(r.token());
        List<byte[]> inviter = jdbc.query(
                "SELECT inviter_id FROM invites WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? FOR UPDATE",
                (rs, i) -> rs.getBytes(1), hash, now());
        if (inviter.isEmpty() || !isActive(inviter.get(0))) {
            throw ApiException.notFound();
        }
        if (com.circlo.server.safety.SafetyController.blockedEitherWay(jdbc, inviter.get(0), me)) {
            throw ApiException.notFound();
        }
        if (java.util.Arrays.equals(inviter.get(0), me)) {
            throw ApiException.badRequest("own_invite");
        }
        jdbc.update("UPDATE invites SET used_at = ?, redeemed_by = ? WHERE token_hash = ?", now(), me, hash);
        return new UserWithIdentity(Ids.uuid(inviter.get(0)), identityOf(inviter.get(0)));
    }

    // ---------- epochs ----------

    public record NewEpoch(@NotNull UUID epochId) {}

    /** Registers a new active epoch for me (older ones become inactive; their posts stay readable). */
    @PostMapping("/v1/epochs")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public NewEpoch newEpoch(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody NewEpoch e) {
        byte[] me = me(jwt);
        jdbc.update("UPDATE epochs SET active = FALSE WHERE owner_id = ?", (Object) me);
        jdbc.update("INSERT INTO epochs (id, owner_id, created_at, active) VALUES (?, ?, ?, TRUE)", Ids.bytes(e.epochId()), me, now());
        return e;
    }

    private void requireMyEpoch(byte[] me, UUID epochId) {
        if (jdbc.queryForList("SELECT 1 FROM epochs WHERE id = ? AND owner_id = ?", Ids.bytes(epochId), me).isEmpty()) {
            throw ApiException.badRequest("unknown_epoch");
        }
    }

    // ---------- friend requests ----------

    public record FriendRequest(@NotNull UUID toUserId, @NotNull UUID epochId,
            @NotNull @Size(min = PAYLOAD_LEN, max = PAYLOAD_LEN) byte[] payload) {}

    @PostMapping("/v1/friends/requests")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Map<String, String> request(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody FriendRequest r) {
        byte[] me = me(jwt);
        byte[] to = Ids.bytes(r.toUserId());
        if (java.util.Arrays.equals(me, to) || !isActive(to) || com.circlo.server.safety.SafetyController.blockedEitherWay(jdbc, me, to)) {
            throw ApiException.notFound();
        }
        // The only way to connect is the target's own invite (link or QR) that I redeemed: there is no search.
        boolean invitedMe = !jdbc.queryForList("SELECT 1 FROM invites WHERE inviter_id = ? AND redeemed_by = ?", to, me).isEmpty();
        if (!invitedMe) {
            throw ApiException.forbidden();
        }
        if (com.circlo.server.safety.SafetyController.blockedEitherWay(jdbc, me, to)) {
            throw ApiException.notFound();
        }
        if (relation(me, to) != null) {
            throw ApiException.conflict("already_connected");
        }
        requireMyEpoch(me, r.epochId());
        jdbc.update("INSERT INTO friendships (id, user_a, user_b, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
                Ids.bytes(Ids.newId()), me, to, now());
        upsertPayload(me, to, r.epochId(), r.payload());
        push.notifyUser(to); // content-free: "new activity"
        return Map.of("status", "outgoing");
    }

    public record Accept(@NotNull UUID epochId, @NotNull @Size(min = PAYLOAD_LEN, max = PAYLOAD_LEN) byte[] payload) {}

    @PostMapping("/v1/friends/{userId}/accept")
    @Transactional
    public Map<String, String> accept(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId,
            @Valid @RequestBody Accept a) {
        byte[] me = me(jwt);
        byte[] other = Ids.bytes(userId);
        if (!"incoming".equals(relation(me, other))) {
            throw ApiException.notFound();
        }
        requireMyEpoch(me, a.epochId());
        jdbc.update("UPDATE friendships SET status = 'accepted' WHERE user_a = ? AND user_b = ?", other, me);
        upsertPayload(me, other, a.epochId(), a.payload());
        return Map.of("status", "accepted");
    }

    @PostMapping("/v1/friends/{userId}/decline")
    @Transactional
    public Map<String, String> decline(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId) {
        byte[] me = me(jwt);
        byte[] other = Ids.bytes(userId);
        if (!"incoming".equals(relation(me, other))) {
            throw ApiException.notFound();
        }
        jdbc.update("DELETE FROM friendships WHERE user_a = ? AND user_b = ?", other, me);
        jdbc.update("DELETE FROM friend_payloads WHERE from_user = ? AND to_user = ?", other, me);
        return Map.of("status", "declined");
    }

    public record Friend(UUID userId, String status, Instant since) {}

    @GetMapping("/v1/friends")
    public List<Friend> friends(@AuthenticationPrincipal Jwt jwt) {
        byte[] me = me(jwt);
        return jdbc.query(
                "SELECT user_a, user_b, status, created_at FROM friendships WHERE (user_a = ? OR user_b = ?) AND status <> 'blocked' ORDER BY created_at",
                (rs, i) -> {
                    byte[] a = rs.getBytes(1);
                    boolean iAsked = java.util.Arrays.equals(a, me);
                    String status = rs.getString(3).equals("accepted") ? "accepted" : (iAsked ? "outgoing" : "incoming");
                    return new Friend(Ids.uuid(iAsked ? rs.getBytes(2) : a), status, rs.getTimestamp(4).toInstant());
                },
                me, me);
    }

    // ---------- friend key payloads ----------

    private void upsertPayload(byte[] from, byte[] to, UUID epochId, byte[] ciphertext) {
        jdbc.update("""
                INSERT INTO friend_payloads (id, from_user, to_user, epoch_id, hpke_ciphertext, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE hpke_ciphertext = VALUES(hpke_ciphertext), created_at = VALUES(created_at)""",
                Ids.bytes(Ids.newId()), from, to, Ids.bytes(epochId), ciphertext, now());
    }

    public record SendPayload(@NotNull UUID toUserId, @NotNull UUID epochId,
            @NotNull @Size(min = PAYLOAD_LEN, max = PAYLOAD_LEN) byte[] ciphertext) {}

    /**
     * Re-wraps after an epoch rotation (Phase 6): allowed for accepted friends and for my own pending requests (so a
     * request accepted after a rotation still carries the current epoch's key).
     */
    @PutMapping("/v1/friend-payloads")
    @Transactional
    public Map<String, String> sendPayload(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody SendPayload p) {
        byte[] me = me(jwt);
        rewrap(me, p);
        return Map.of("status", "ok");
    }

    private void rewrap(byte[] me, SendPayload p) {
        byte[] to = Ids.bytes(p.toUserId());
        String rel = relation(me, to);
        if (!"accepted".equals(rel) && !"outgoing".equals(rel)) {
            throw ApiException.forbidden();
        }
        requireMyEpoch(me, p.epochId());
        upsertPayload(me, to, p.epochId(), p.ciphertext());
    }

    public record PayloadBatch(@NotNull @Size(min = 1, max = 500) List<@Valid SendPayload> payloads) {}

    /** All-or-nothing re-wrap for many friends at once (an epoch rotation re-wraps for everyone). */
    @PutMapping("/v1/friend-payloads/batch")
    @Transactional
    public Map<String, Object> sendPayloads(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody PayloadBatch batch) {
        byte[] me = me(jwt);
        batch.payloads().forEach(p -> rewrap(me, p));
        return Map.of("status", "ok", "count", batch.payloads().size());
    }

    /** Removes the friendship (either direction) and every payload between us. The client then rotates its epoch. */
    @org.springframework.web.bind.annotation.DeleteMapping("/v1/friends/{userId}")
    @Transactional
    public Map<String, String> unfriend(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId) {
        byte[] me = me(jwt);
        byte[] other = Ids.bytes(userId);
        String rel = relation(me, other);
        if (rel == null || rel.equals("blocked")) {
            throw ApiException.notFound();
        }
        jdbc.update("DELETE FROM friendships WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)", me, other, other, me);
        jdbc.update("DELETE FROM friend_payloads WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)",
                me, other, other, me);
        return Map.of("status", "removed");
    }

    public record Payload(UUID fromUserId, UUID epochId, byte[] ciphertext, Instant createdAt) {}

    /** Payloads addressed to me from one user (all epochs). Requires a friendship in any non-blocked state. */
    @GetMapping("/v1/friend-payloads")
    public List<Payload> payloadsFrom(@AuthenticationPrincipal Jwt jwt, @RequestParam("from") UUID from) {
        byte[] me = me(jwt);
        String rel = relation(me, Ids.bytes(from));
        if (rel == null || rel.equals("blocked")) {
            throw ApiException.notFound();
        }
        return jdbc.query(
                "SELECT epoch_id, hpke_ciphertext, created_at FROM friend_payloads WHERE from_user = ? AND to_user = ? ORDER BY created_at",
                (rs, i) -> new Payload(from, Ids.uuid(rs.getBytes(1)), rs.getBytes(2), rs.getTimestamp(3).toInstant()),
                Ids.bytes(from), me);
    }

    // ---------- encrypted profile and blobs ----------

    public record Blob(UUID epochId, byte[] ciphertext, int version) {}

    public record PutBlob(UUID epochId, @NotNull @Size(min = 1, max = 1 << 20) byte[] ciphertext, @Min(1) int version) {}

    private static String blobKind(String k) {
        return switch (k) {
            case "address_book", "settings", "profile" -> k;
            default -> throw ApiException.notFound();
        };
    }

    /** Optimistic: version 1 creates, then each write must be stored version + 1. */
    private Blob putBlob(byte[] me, String kind, PutBlob b) {
        if (kind.equals("profile")) {
            if (b.epochId() == null) {
                throw ApiException.badRequest("epoch_required");
            }
            requireMyEpoch(me, b.epochId());
        }
        byte[] epoch = b.epochId() == null ? null : Ids.bytes(b.epochId());
        int n = b.version() == 1
                ? jdbc.update("INSERT IGNORE INTO user_blobs (user_id, kind, epoch_id, ciphertext, version) VALUES (?, ?, ?, ?, 1)",
                        me, kind, epoch, b.ciphertext())
                : jdbc.update("UPDATE user_blobs SET ciphertext = ?, epoch_id = ?, version = ? WHERE user_id = ? AND kind = ? AND version = ?",
                        b.ciphertext(), epoch, b.version(), me, kind, b.version() - 1);
        if (n != 1) {
            throw ApiException.conflict("version_conflict");
        }
        return new Blob(b.epochId(), b.ciphertext(), b.version());
    }

    private Blob getBlob(byte[] user, String kind) {
        return jdbc.query("SELECT epoch_id, ciphertext, version FROM user_blobs WHERE user_id = ? AND kind = ?",
                        (rs, i) -> new Blob(rs.getBytes(1) == null ? null : Ids.uuid(rs.getBytes(1)), rs.getBytes(2), rs.getInt(3)),
                        user, kind)
                .stream().findFirst().orElseThrow(ApiException::notFound);
    }

    @PutMapping("/v1/blobs/{kind}")
    @Transactional
    public Blob putMyBlob(@AuthenticationPrincipal Jwt jwt, @PathVariable("kind") String kind, @Valid @RequestBody PutBlob b) {
        return putBlob(me(jwt), blobKind(kind), b);
    }

    @GetMapping("/v1/blobs/{kind}")
    public Blob getMyBlob(@AuthenticationPrincipal Jwt jwt, @PathVariable("kind") String kind) {
        return getBlob(me(jwt), blobKind(kind));
    }

    /** Another user's encrypted profile: only for people they're connected to (any non-blocked state). */
    @GetMapping("/v1/users/{userId}/profile")
    public Blob profile(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId) {
        byte[] me = me(jwt);
        byte[] other = Ids.bytes(userId);
        if (!java.util.Arrays.equals(me, other)) {
            String rel = relation(me, other);
            if (rel == null || rel.equals("blocked")) {
                throw ApiException.notFound();
            }
        }
        return getBlob(other, "profile");
    }
}
