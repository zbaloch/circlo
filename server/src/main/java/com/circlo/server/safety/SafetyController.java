package com.circlo.server.safety;

import com.circlo.server.config.ServerSecrets;
import com.circlo.server.crypto.CoreException;
import com.circlo.server.crypto.CircloCore;
import com.circlo.server.storage.MediaStore;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import com.circlo.server.web.RateLimiter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
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

/** Phase 11: blocking, sealed reports, and account deletion (everything the user left behind is removed). */
@RestController
public class SafetyController {

    private final JdbcTemplate jdbc;
    private final CircloCore core;
    private final ServerSecrets secrets;
    private final MediaStore store;
    private final RateLimiter limiter;
    private final String moderationPublicKey;

    public SafetyController(JdbcTemplate jdbc, CircloCore core, ServerSecrets secrets, MediaStore store, RateLimiter limiter,
            @Value("${circlo.moderation.public-key:}") String moderationPublicKey) {
        this.jdbc = jdbc;
        this.core = core;
        this.secrets = secrets;
        this.store = store;
        this.limiter = limiter;
        this.moderationPublicKey = moderationPublicKey;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(UUID.fromString(jwt.getSubject()));
    }

    /** True if either user blocked the other. */
    public static boolean blockedEitherWay(JdbcTemplate jdbc, byte[] a, byte[] b) {
        return !jdbc.queryForList("SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)",
                a, b, b, a).isEmpty();
    }

    // ---------- reports ----------

    public record NewReport(@NotNull UUID reportId, @NotNull @Size(min = 64, max = 4 << 20) byte[] sealed) {}

    /**
     * Stores a report sealed on the reporter's phone to the moderation key, under the id bound into its AAD; the
     * server can't read it.
     */
    @PostMapping("/v1/reports")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, String> report(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody NewReport r) {
        byte[] me = me(jwt);
        if (!limiter.tryAcquire("reports", me, 20, 3_600_000)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited");
        }
        try {
            jdbc.update("INSERT INTO reports (id, reporter_id, sealed, created_at) VALUES (?, ?, ?, ?)",
                    Ids.bytes(r.reportId()), me, r.sealed(), Timestamp.from(Instant.now()));
        } catch (DuplicateKeyException e) {
            throw new ApiException(HttpStatus.CONFLICT, "duplicate_report");
        }
        return Map.of("status", "received");
    }

    /** Client configuration: the operator's moderation public key (empty if reporting isn't set up). */
    @GetMapping("/v1/config")
    public Map<String, String> config() {
        return Map.of("moderationPublicKey", moderationPublicKey);
    }

    // ---------- blocks ----------

    /** Blocks a user: removes any friendship and payloads between us; neither side can request or redeem invites. */
    @PostMapping("/v1/blocks/{userId}")
    @Transactional
    public Map<String, String> block(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId) {
        byte[] me = me(jwt);
        byte[] other = Ids.bytes(userId);
        if (java.util.Arrays.equals(me, other) || jdbc.queryForList("SELECT 1 FROM users WHERE id = ?", (Object) other).isEmpty()) {
            throw ApiException.notFound();
        }
        jdbc.update("INSERT IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)", me, other, Timestamp.from(Instant.now()));
        jdbc.update("DELETE FROM friendships WHERE (user_a = ? AND user_b = ?) OR (user_a = ? AND user_b = ?)", me, other, other, me);
        jdbc.update("DELETE FROM friend_payloads WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)", me, other, other, me);
        return Map.of("status", "blocked");
    }

    @DeleteMapping("/v1/blocks/{userId}")
    public Map<String, String> unblock(@AuthenticationPrincipal Jwt jwt, @PathVariable("userId") UUID userId) {
        jdbc.update("DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?", me(jwt), Ids.bytes(userId));
        return Map.of("status", "unblocked");
    }

    public record BlockView(UUID userId, Instant createdAt) {}

    @GetMapping("/v1/blocks")
    public List<BlockView> blocks(@AuthenticationPrincipal Jwt jwt) {
        return jdbc.query("SELECT blocked_id, created_at FROM user_blocks WHERE blocker_id = ? ORDER BY created_at DESC",
                (rs, i) -> new BlockView(Ids.uuid(rs.getBytes(1)), rs.getTimestamp(2).toInstant()), (Object) me(jwt));
    }

    // ---------- account deletion ----------

    public record DeleteAccount(@NotNull @Size(min = 1, max = 64) String handle) {}

    /**
     * Deletes my account. The user retypes their handle as confirmation. Ciphertext objects in the bucket go first,
     * then the user row; every other row (posts, replies, likes, blobs, devices, friendships, keys, messages'
     * memberships, tokens) cascades. Nothing is kept.
     */
    @DeleteMapping("/v1/account")
    @Transactional
    public Map<String, String> deleteAccount(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody DeleteAccount r) {
        byte[] me = me(jwt);
        byte[] stored = jdbc.query("SELECT handle_lookup FROM users WHERE id = ?", (rs, i) -> rs.getBytes(1), (Object) me).stream().findFirst()
                .orElseThrow(ApiException::notFound);
        byte[] typed;
        try {
            typed = core.handleLookup(secrets.handleKey(), r.handle());
        } catch (CoreException e) {
            throw ApiException.badRequest("confirmation_mismatch");
        }
        if (!MessageDigest.isEqual(stored, typed)) {
            throw ApiException.badRequest("confirmation_mismatch");
        }
        for (String key : jdbc.queryForList("SELECT object_key FROM media_uploads WHERE owner_id = ?", String.class, (Object) me)) {
            store.delete(key);
        }
        jdbc.update("DELETE FROM users WHERE id = ?", (Object) me);
        return Map.of("status", "deleted");
    }
}
