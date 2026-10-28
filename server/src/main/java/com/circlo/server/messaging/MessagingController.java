package com.circlo.server.messaging;

import com.circlo.server.crypto.CoreException;
import com.circlo.server.crypto.CircloCore;
import com.circlo.server.posts.MediaSweeper;
import com.circlo.server.posts.PostAccess;
import com.circlo.server.push.PushService;
import com.circlo.server.storage.MediaStore;
import java.util.OptionalLong;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import com.circlo.server.web.RateLimiter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * MLS delivery service (PLAN.md Phase 9, CRYPTO.md 13a): key packages, one ordered log per group, welcomes. An opaque
 * relay: it reads only the clear MLS framing (group id, epoch, commit or not) to order commits, and keeps a device
 * ACL so only current members fetch and post.
 */
@RestController
public class MessagingController {

    static final int MAX_MESSAGE = 1 << 20;
    static final int MAX_KEY_PACKAGES = 50;
    static final Duration RETENTION = Duration.ofDays(30);

    private final JdbcTemplate jdbc;
    private final CircloCore core;
    private final PostAccess access;
    private final RateLimiter limiter;
    private final PushService push;
    private final MediaStore store;

    public MessagingController(JdbcTemplate jdbc, CircloCore core, PostAccess access, RateLimiter limiter, PushService push, MediaStore store) {
        this.jdbc = jdbc;
        this.core = core;
        this.access = access;
        this.limiter = limiter;
        this.push = push;
        this.store = store;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(UUID.fromString(jwt.getSubject()));
    }

    private static Timestamp now() {
        return Timestamp.from(Instant.now());
    }

    /** The calling device: must be one of my registered, unrevoked devices. */
    private byte[] myDevice(byte[] me, String header) {
        UUID id;
        try {
            id = UUID.fromString(header);
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("bad_device");
        }
        byte[] device = Ids.bytes(id);
        if (jdbc.queryForList("SELECT 1 FROM devices WHERE id = ? AND user_id = ? AND revoked_at IS NULL", device, me).isEmpty()) {
            throw ApiException.forbidden();
        }
        return device;
    }

    private void requireMember(byte[] group, byte[] device) {
        if (jdbc.queryForList("SELECT 1 FROM mls_group_members WHERE group_id = ? AND device_id = ?", group, device).isEmpty()) {
            throw ApiException.notFound();
        }
    }

    // ---------- key packages ----------

    public record KeyPackages(@NotNull @Size(max = MAX_KEY_PACKAGES) List<@Size(min = 64, max = 4096) byte[]> keyPackages,
            @Size(min = 64, max = 4096) byte[] lastResort) {}

    /** Adds one-time key packages for my device and replaces its last-resort package. */
    @PutMapping("/v1/mls/key-packages")
    @Transactional
    public Map<String, Object> uploadKeyPackages(@AuthenticationPrincipal Jwt jwt, @RequestHeader("X-Circlo-Device") String deviceHeader,
            @Valid @RequestBody KeyPackages r) {
        byte[] me = me(jwt);
        byte[] device = myDevice(me, deviceHeader);
        Integer unused = jdbc.queryForObject(
                "SELECT COUNT(*) FROM mls_key_packages WHERE device_id = ? AND used = FALSE AND last_resort = FALSE", Integer.class,
                (Object) device);
        int have = unused == null ? 0 : unused;
        if (have + r.keyPackages().size() > MAX_KEY_PACKAGES) {
            throw ApiException.badRequest("too_many_key_packages");
        }
        for (byte[] kp : r.keyPackages()) {
            jdbc.update("INSERT INTO mls_key_packages (id, user_id, device_id, key_package, created_at) VALUES (?, ?, ?, ?, ?)",
                    Ids.bytes(Ids.newId()), me, device, kp, now());
        }
        if (r.lastResort() != null) {
            jdbc.update("DELETE FROM mls_key_packages WHERE device_id = ? AND last_resort = TRUE", (Object) device);
            jdbc.update(
                    "INSERT INTO mls_key_packages (id, user_id, device_id, key_package, last_resort, created_at) VALUES (?, ?, ?, ?, TRUE, ?)",
                    Ids.bytes(Ids.newId()), me, device, r.lastResort(), now());
        }
        return Map.of("available", have + r.keyPackages().size());
    }

    public record Claim(@NotNull @Size(max = 50) List<UUID> userIds, @Size(max = 200) List<UUID> deviceIds) {}

    public record ClaimedKeyPackage(UUID userId, UUID deviceId, byte[] keyPackage) {}

    /** One key package per active device of each user (me or accepted friends); one-time packages are consumed. */
    @PostMapping("/v1/mls/key-packages/claim")
    @Transactional
    public Map<String, Object> claim(@AuthenticationPrincipal Jwt jwt, @RequestHeader("X-Circlo-Device") String deviceHeader,
            @Valid @RequestBody Claim r) {
        byte[] me = me(jwt);
        myDevice(me, deviceHeader);
        if (!limiter.tryAcquire("kp-claim", me, 120, 60_000)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited");
        }
        List<ClaimedKeyPackage> out = new ArrayList<>();
        for (UUID userId : r.userIds()) {
            byte[] user = Ids.bytes(userId);
            if (!access.canRead(me, user)) {
                throw ApiException.notFound();
            }
            List<byte[]> devices = jdbc.query("SELECT id FROM devices WHERE user_id = ? AND revoked_at IS NULL",
                    (rs, i) -> rs.getBytes(1), (Object) user);
            for (byte[] device : devices) {
                List<Object[]> kp = jdbc.query(
                        "SELECT id, key_package, last_resort FROM mls_key_packages WHERE device_id = ? AND used = FALSE "
                                + "ORDER BY last_resort, created_at LIMIT 1 FOR UPDATE",
                        (rs, i) -> new Object[] {rs.getBytes(1), rs.getBytes(2), rs.getBoolean(3)}, (Object) device);
                if (kp.isEmpty()) {
                    continue; // a device that never set up messaging
                }
                Object[] row = kp.get(0);
                if (!(Boolean) row[2]) {
                    jdbc.update("DELETE FROM mls_key_packages WHERE id = ?", row[0]);
                }
                out.add(new ClaimedKeyPackage(userId, Ids.uuid(device), (byte[]) row[1]));
            }
        }
        // Specific devices (e.g. a friend's new phone missing from a chat): each must be mine or a friend's, and active.
        for (UUID deviceId : r.deviceIds() == null ? List.<UUID>of() : r.deviceIds()) {
            byte[] device = Ids.bytes(deviceId);
            byte[] owner = jdbc.query("SELECT user_id FROM devices WHERE id = ? AND revoked_at IS NULL", (rs, i) -> rs.getBytes(1), (Object) device)
                    .stream().findFirst().orElseThrow(ApiException::notFound);
            if (!access.canRead(me, owner)) {
                throw ApiException.notFound();
            }
            ClaimedKeyPackage kp = takeKeyPackage(Ids.uuid(owner), device);
            if (kp == null) {
                throw ApiException.notFound();
            }
            out.add(kp);
        }
        return Map.of("keyPackages", out);
    }

    private ClaimedKeyPackage takeKeyPackage(UUID userId, byte[] device) {
        List<Object[]> kp = jdbc.query(
                "SELECT id, key_package, last_resort FROM mls_key_packages WHERE device_id = ? AND used = FALSE "
                        + "ORDER BY last_resort, created_at LIMIT 1 FOR UPDATE",
                (rs, i) -> new Object[] {rs.getBytes(1), rs.getBytes(2), rs.getBoolean(3)}, (Object) device);
        if (kp.isEmpty()) {
            return null;
        }
        if (!(Boolean) kp.get(0)[2]) {
            jdbc.update("DELETE FROM mls_key_packages WHERE id = ?", kp.get(0)[0]);
        }
        return new ClaimedKeyPackage(userId, Ids.uuid(device), (byte[]) kp.get(0)[1]);
    }

    public record MissingDevice(UUID userId, UUID deviceId) {}

    /**
     * Active devices of this group's members that aren't in the group yet and can be added (they uploaded key
     * packages): a member's new phone. Any member may add them; commit ordering resolves races.
     */
    @GetMapping("/v1/mls/groups/{groupId}/missing-devices")
    public List<MissingDevice> missingDevices(@AuthenticationPrincipal Jwt jwt, @RequestHeader("X-Circlo-Device") String deviceHeader,
            @PathVariable("groupId") UUID groupId) {
        byte[] device = myDevice(me(jwt), deviceHeader);
        byte[] group = Ids.bytes(groupId);
        requireMember(group, device);
        return jdbc.query("""
                SELECT d.user_id, d.id FROM devices d
                WHERE d.revoked_at IS NULL
                  AND d.user_id IN (SELECT DISTINCT user_id FROM mls_group_members WHERE group_id = ?)
                  AND d.id NOT IN (SELECT device_id FROM mls_group_members WHERE group_id = ?)
                  AND EXISTS (SELECT 1 FROM mls_key_packages k WHERE k.device_id = d.id AND k.used = FALSE)""",
                (rs, i) -> new MissingDevice(Ids.uuid(rs.getBytes(1)), Ids.uuid(rs.getBytes(2))), group, group);
    }

    public record AttachMedia(@NotNull @Size(min = 1, max = 12) List<@jakarta.validation.constraints.Pattern(regexp = "[0-9a-f]{64}") String> objectKeys) {}

    /** Attaches my uploaded ciphertext objects to a chat, so only its members can download them (30-day retention). */
    @PostMapping("/v1/mls/groups/{groupId}/media")
    @Transactional
    public Map<String, String> attachMedia(@AuthenticationPrincipal Jwt jwt, @RequestHeader("X-Circlo-Device") String deviceHeader,
            @PathVariable("groupId") UUID groupId, @Valid @RequestBody AttachMedia r) {
        byte[] me = me(jwt);
        byte[] device = myDevice(me, deviceHeader);
        byte[] group = Ids.bytes(groupId);
        requireMember(group, device);
        for (String key : r.objectKeys()) {
            List<Long> declared = jdbc.query(
                    "SELECT ct_size FROM media_uploads WHERE object_key = ? AND owner_id = ? AND post_id IS NULL AND group_id IS NULL "
                            + "AND created_at > ? FOR UPDATE",
                    (rs, i) -> rs.getLong(1), key, me, Timestamp.from(Instant.now().minus(MediaSweeper.ATTACH_WINDOW)));
            if (declared.isEmpty()) {
                throw ApiException.badRequest("unknown_media");
            }
            OptionalLong stored = store.size(key);
            if (stored.isEmpty() || stored.getAsLong() != declared.get(0)) {
                throw ApiException.badRequest("media_not_uploaded");
            }
            jdbc.update("UPDATE media_uploads SET group_id = ? WHERE object_key = ?", group, key);
        }
        return Map.of("status", "attached");
    }

    // ---------- groups and messages ----------

    public record NewGroup(@NotNull UUID groupId) {}

    @PostMapping("/v1/mls/groups")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Map<String, Object> createGroup(@AuthenticationPrincipal Jwt jwt, @RequestHeader("X-Circlo-Device") String deviceHeader,
            @Valid @RequestBody NewGroup r) {
        byte[] me = me(jwt);
        byte[] device = myDevice(me, deviceHeader);
        byte[] group = Ids.bytes(r.groupId());
        jdbc.update("INSERT INTO mls_groups (id, created_at, epoch) VALUES (?, ?, 0)", group, now());
        jdbc.update("INSERT INTO mls_group_members (group_id, device_id, user_id, added_at) VALUES (?, ?, ?, ?)", group, device, me, now());
        return Map.of("groupId", r.groupId());
    }

    public record GroupView(UUID groupId, long epoch, long lastSeq) {}

    /** Groups this device belongs to, with the latest sequence number (for the inbox). */
    @GetMapping("/v1/mls/groups")
    public List<GroupView> groups(@AuthenticationPrincipal Jwt jwt, @RequestHeader("X-Circlo-Device") String deviceHeader) {
        byte[] device = myDevice(me(jwt), deviceHeader);
        return jdbc.query("SELECT g.id, g.epoch, COALESCE((SELECT MAX(m.id) FROM mls_messages m WHERE m.group_id = g.id), 0) "
                + "FROM mls_groups g JOIN mls_group_members gm ON gm.group_id = g.id WHERE gm.device_id = ?",
                (rs, i) -> new GroupView(Ids.uuid(rs.getBytes(1)), rs.getLong(2), rs.getLong(3)), (Object) device);
    }

    public record NewMessage(@NotNull @Size(min = 1, max = MAX_MESSAGE) byte[] message,
            @Size(max = 200) List<UUID> addDevices, @Size(max = 200) List<UUID> removeDevices,
            @Size(max = MAX_MESSAGE) byte[] welcome) {}

    /**
     * Appends to the group's log. A commit must target the current epoch (first commit wins; the loser gets 409,
     * refetches and retries) and carries the membership changes it makes, so the device ACL stays in step.
     */
    @PostMapping("/v1/mls/groups/{groupId}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Map<String, Object> post(@AuthenticationPrincipal Jwt jwt, @RequestHeader("X-Circlo-Device") String deviceHeader,
            @PathVariable("groupId") UUID groupId, @Valid @RequestBody NewMessage r) {
        byte[] me = me(jwt);
        byte[] device = myDevice(me, deviceHeader);
        byte[] group = Ids.bytes(groupId);
        requireMember(group, device);
        if (!limiter.tryAcquire("mls-post", me, 600, 60_000)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited");
        }
        CircloCore.MlsMeta meta;
        try {
            meta = core.mlsMessageMeta(r.message());
        } catch (CoreException e) {
            throw ApiException.badRequest("not_mls");
        }
        if (!Arrays.equals(meta.groupId(), group)) {
            throw ApiException.badRequest("wrong_group");
        }
        long epoch = jdbc.queryForObject("SELECT epoch FROM mls_groups WHERE id = ? FOR UPDATE", Long.class, (Object) group);
        List<UUID> add = r.addDevices() == null ? List.of() : r.addDevices();
        List<UUID> remove = r.removeDevices() == null ? List.of() : r.removeDevices();
        if (meta.commit()) {
            if (meta.epoch() != epoch) {
                throw ApiException.conflict("stale_epoch");
            }
            for (UUID d : add) {
                byte[] owner = jdbc.query("SELECT user_id FROM devices WHERE id = ? AND revoked_at IS NULL", (rs, i) -> rs.getBytes(1),
                        (Object) Ids.bytes(d)).stream().findFirst().orElseThrow(() -> ApiException.badRequest("unknown_device"));
                // Only my own devices or accepted friends' devices can be added (no unsolicited group adds).
                if (!access.canRead(me, owner)) {
                    throw ApiException.badRequest("not_a_friend");
                }
                jdbc.update("INSERT IGNORE INTO mls_group_members (group_id, device_id, user_id, added_at) VALUES (?, ?, ?, ?)",
                        group, Ids.bytes(d), owner, now());
            }
            for (UUID d : remove) {
                jdbc.update("DELETE FROM mls_group_members WHERE group_id = ? AND device_id = ?", group, Ids.bytes(d));
            }
            jdbc.update("UPDATE mls_groups SET epoch = epoch + 1 WHERE id = ?", (Object) group);
        } else if (!add.isEmpty() || !remove.isEmpty() || r.welcome() != null) {
            throw ApiException.badRequest("membership_change_without_commit");
        }
        jdbc.update("INSERT INTO mls_messages (group_id, epoch, ciphertext, created_at) VALUES (?, ?, ?, ?)", group, meta.epoch(),
                r.message(), now());
        long seq = jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        if (r.welcome() != null) {
            for (UUID d : add) {
                jdbc.update(
                        "INSERT INTO mls_welcomes (id, recipient_device_id, ciphertext, created_at, group_id, after_seq) VALUES (?, ?, ?, ?, ?, ?)",
                        Ids.bytes(Ids.newId()), Ids.bytes(d), r.welcome(), now(), group, seq);
            }
        }
        // Content-free push to every other device in the group (never the sender's own).
        push.notifyDevices(jdbc.query("SELECT device_id FROM mls_group_members WHERE group_id = ? AND device_id <> ?",
                (rs, i) -> rs.getBytes(1), group, device));
        return Map.of("seq", seq);
    }

    public record MessageView(long seq, byte[] message, Instant createdAt) {}

    @GetMapping("/v1/mls/groups/{groupId}/messages")
    public List<MessageView> messages(@AuthenticationPrincipal Jwt jwt, @RequestHeader("X-Circlo-Device") String deviceHeader,
            @PathVariable("groupId") UUID groupId, @RequestParam(value = "after", defaultValue = "0") long after,
            @RequestParam(value = "limit", defaultValue = "200") int limit) {
        byte[] device = myDevice(me(jwt), deviceHeader);
        byte[] group = Ids.bytes(groupId);
        requireMember(group, device);
        return jdbc.query("SELECT id, ciphertext, created_at FROM mls_messages WHERE group_id = ? AND id > ? ORDER BY id LIMIT ?",
                (rs, i) -> new MessageView(rs.getLong(1), rs.getBytes(2), rs.getTimestamp(3).toInstant()),
                group, after, Math.max(1, Math.min(limit, 500)));
    }

    // ---------- welcomes ----------

    public record WelcomeView(UUID welcomeId, UUID groupId, byte[] welcome, long afterSeq) {}

    @GetMapping("/v1/mls/welcomes")
    public List<WelcomeView> welcomes(@AuthenticationPrincipal Jwt jwt, @RequestHeader("X-Circlo-Device") String deviceHeader) {
        byte[] device = myDevice(me(jwt), deviceHeader);
        return jdbc.query("SELECT id, group_id, ciphertext, after_seq FROM mls_welcomes WHERE recipient_device_id = ? ORDER BY created_at",
                (rs, i) -> new WelcomeView(Ids.uuid(rs.getBytes(1)), Ids.uuid(rs.getBytes(2)), rs.getBytes(3), rs.getLong(4)),
                (Object) device);
    }

    @DeleteMapping("/v1/mls/welcomes/{welcomeId}")
    public Map<String, String> deleteWelcome(@AuthenticationPrincipal Jwt jwt, @RequestHeader("X-Circlo-Device") String deviceHeader,
            @PathVariable("welcomeId") UUID welcomeId) {
        byte[] device = myDevice(me(jwt), deviceHeader);
        if (jdbc.update("DELETE FROM mls_welcomes WHERE id = ? AND recipient_device_id = ?", Ids.bytes(welcomeId), device) != 1) {
            throw ApiException.notFound();
        }
        return Map.of("status", "deleted");
    }

    /** Ciphertext isn't kept forever: messages, welcomes and chat media older than 30 days are dropped. */
    @Scheduled(fixedDelay = 3_600_000, initialDelay = 120_000)
    void purgeOldMessages() {
        try {
            Timestamp cutoff = Timestamp.from(Instant.now().minus(RETENTION));
            jdbc.update("DELETE FROM mls_messages WHERE created_at < ?", cutoff);
            jdbc.update("DELETE FROM mls_welcomes WHERE created_at < ?", cutoff);
            jdbc.update("UPDATE media_uploads SET group_id = NULL, created_at = ? WHERE group_id IS NOT NULL AND created_at < ?",
                    Timestamp.from(Instant.EPOCH), cutoff);
        } catch (RuntimeException e) {
            // try again next hour
        }
    }
}
