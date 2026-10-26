package com.halqo.server.account;

import com.halqo.server.auth.TokenService;
import com.halqo.server.push.PushService;
import com.halqo.server.web.ApiException;
import com.halqo.server.web.Ids;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Phase 10: revoking devices, push-token registration, and the one-time device-link hand-off (CRYPTO.md 13b). */
@RestController
public class DeviceController {

    static final Duration LINK_TTL = Duration.ofMinutes(10);

    private final JdbcTemplate jdbc;
    private final PushService push;
    private final TokenService tokens;

    public DeviceController(JdbcTemplate jdbc, PushService push, TokenService tokens) {
        this.jdbc = jdbc;
        this.push = push;
        this.tokens = tokens;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(UUID.fromString(jwt.getSubject()));
    }

    private void requireMyDevice(byte[] me, byte[] device) {
        if (jdbc.queryForList("SELECT 1 FROM devices WHERE id = ? AND user_id = ? AND revoked_at IS NULL", device, me).isEmpty()) {
            throw ApiException.notFound();
        }
    }

    /**
     * Revokes one of my devices: it can no longer use messaging, gets no pushes, and its key packages and pending
     * welcomes are deleted. Its MLS leaves are removed from chats by the members' apps.
     */
    @DeleteMapping("/v1/devices/{deviceId}")
    @Transactional
    public Map<String, String> revoke(@AuthenticationPrincipal Jwt jwt, @PathVariable("deviceId") UUID deviceId) {
        byte[] me = me(jwt);
        byte[] device = Ids.bytes(deviceId);
        requireMyDevice(me, device);
        jdbc.update("UPDATE devices SET revoked_at = ?, push_token_enc = NULL, push_platform = NULL WHERE id = ?", Timestamp.from(Instant.now()), device);
        jdbc.update("DELETE FROM mls_group_members WHERE device_id = ?", (Object) device);
        jdbc.update("DELETE FROM mls_key_packages WHERE device_id = ?", (Object) device);
        jdbc.update("DELETE FROM mls_welcomes WHERE recipient_device_id = ?", (Object) device);
        return Map.of("status", "revoked");
    }

    public record PushToken(@NotNull @Size(min = 1, max = 4096) String token, @NotNull @Pattern(regexp = "android|ios") String platform) {}

    /** Stores this device's push token sealed with HALQO_PUSH_TOKEN_KEY (the DB alone can't reveal it). */
    @PutMapping("/v1/devices/{deviceId}/push-token")
    public Map<String, String> pushToken(@AuthenticationPrincipal Jwt jwt, @PathVariable("deviceId") UUID deviceId, @Valid @RequestBody PushToken r) {
        byte[] me = me(jwt);
        byte[] device = Ids.bytes(deviceId);
        requireMyDevice(me, device);
        jdbc.update("UPDATE devices SET push_token_enc = ?, push_platform = ? WHERE id = ?",
                push.sealToken(device, r.token().getBytes(StandardCharsets.UTF_8)), r.platform(), device);
        return Map.of("status", "registered");
    }

    // ---------- device links ----------

    public record NewLink(@NotNull @Size(min = 32, max = 32) byte[] linkId, @NotNull @Size(min = 64, max = 16_384) byte[] sealed) {}

    /** The existing (signed-in) device posts the account secrets sealed to the new device's QR key. */
    @PostMapping("/v1/device-links")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, String> createLink(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody NewLink r) {
        jdbc.update("INSERT INTO device_links (link_id, user_id, sealed, expires_at) VALUES (?, ?, ?, ?)",
                r.linkId(), me(jwt), r.sealed(), Timestamp.from(Instant.now().plus(LINK_TTL)));
        return Map.of("status", "created");
    }

    public record LinkPickup(UUID userId, byte[] sealed, String accessToken, String refreshToken) {}

    /**
     * The new device picks up the hand-off once (by the random link id from its own QR code) together with a session.
     * Unauthenticated by necessity; single use, 10-minute expiry, rate-limited per client.
     */
    @GetMapping("/v1/device-links/{linkId}")
    @Transactional
    public LinkPickup pickUp(@PathVariable("linkId") String linkIdB64) {
        byte[] linkId;
        try {
            linkId = Base64.getUrlDecoder().decode(linkIdB64);
        } catch (IllegalArgumentException e) {
            throw ApiException.notFound();
        }
        List<Object[]> rows = jdbc.query("SELECT user_id, sealed FROM device_links WHERE link_id = ? AND expires_at > ? FOR UPDATE",
                (rs, i) -> new Object[] {rs.getBytes(1), rs.getBytes(2)}, linkId, Timestamp.from(Instant.now()));
        if (rows.isEmpty()) {
            throw ApiException.notFound();
        }
        jdbc.update("DELETE FROM device_links WHERE link_id = ?", (Object) linkId);
        UUID userId = Ids.uuid((byte[]) rows.get(0)[0]);
        TokenService.Tokens t = tokens.issue(userId, TokenService.Scope.full);
        return new LinkPickup(userId, (byte[]) rows.get(0)[1], t.accessToken(), t.refreshToken());
    }

    @Scheduled(fixedDelay = 600_000, initialDelay = 60_000)
    void purgeExpiredLinks() {
        try {
            jdbc.update("DELETE FROM device_links WHERE expires_at < ?", Timestamp.from(Instant.now()));
        } catch (RuntimeException e) {
            // next run
        }
    }
}
