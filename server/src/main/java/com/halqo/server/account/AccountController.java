package com.halqo.server.account;

import com.halqo.server.crypto.HalqoCore;
import com.halqo.server.web.ApiException;
import com.halqo.server.web.Ids;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
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
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Key backups, devices and identity keys. Everything stored is ciphertext or a public key. */
@RestController
public class AccountController {

    private final JdbcTemplate jdbc;
    private final HalqoCore core;

    public AccountController(JdbcTemplate jdbc, HalqoCore core) {
        this.jdbc = jdbc;
        this.core = core;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(UUID.fromString(jwt.getSubject()));
    }

    private static String kind(String k) {
        if (!k.equals("password") && !k.equals("recovery")) {
            throw ApiException.notFound();
        }
        return k;
    }

    // ---------- key backups ----------

    public record Backup(byte[] ciphertext, int version) {}

    public record PutBackup(@NotNull @Size(min = 1, max = 1 << 20) byte[] ciphertext, @Min(2) int version) {}

    @GetMapping("/v1/backups/{kind}")
    public Backup getBackup(@AuthenticationPrincipal Jwt jwt, @PathVariable("kind") String kind) {
        return jdbc.query("SELECT ciphertext, version FROM key_backups WHERE user_id = ? AND kind = ?",
                        (rs, i) -> new Backup(rs.getBytes(1), rs.getInt(2)), me(jwt), kind(kind))
                .stream().findFirst().orElseThrow(ApiException::notFound);
    }

    /** Optimistic concurrency: {@code version} must be exactly the stored version + 1. */
    @PutMapping("/v1/backups/{kind}")
    @Transactional
    public Backup putBackup(@AuthenticationPrincipal Jwt jwt, @PathVariable("kind") String kind,
            @Valid @RequestBody PutBackup b) {
        int n = jdbc.update("UPDATE key_backups SET ciphertext = ?, version = ? WHERE user_id = ? AND kind = ? AND version = ?",
                b.ciphertext(), b.version(), me(jwt), kind(kind), b.version() - 1);
        if (n != 1) {
            throw ApiException.conflict("version_conflict");
        }
        return new Backup(b.ciphertext(), b.version());
    }

    // ---------- devices ----------

    public record RegisterDevice(@NotNull UUID deviceId, @NotNull @Size(min = 32, max = 32) byte[] devicePubkey,
            @NotNull @Size(min = 64, max = 64) byte[] deviceCert) {}

    public record DeviceView(UUID deviceId, byte[] devicePubkey, byte[] deviceCert, Instant createdAt, boolean revoked) {}

    @PostMapping("/v1/devices")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public DeviceView registerDevice(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody RegisterDevice d) {
        byte[] user = me(jwt);
        byte[] identityPk = jdbc.query("SELECT ed25519_pub FROM identity_keys WHERE user_id = ?",
                (rs, i) -> rs.getBytes(1), (Object) user).stream().findFirst().orElseThrow(ApiException::forbidden);
        if (!core.verifyDeviceCertificate(identityPk, user, Ids.bytes(d.deviceId()), d.devicePubkey(), d.deviceCert())) {
            throw ApiException.badRequest("bad_device_certificate");
        }
        Instant now = Instant.now();
        jdbc.update("INSERT INTO devices (id, user_id, device_pubkey, device_cert, created_at) VALUES (?, ?, ?, ?, ?)",
                Ids.bytes(d.deviceId()), user, d.devicePubkey(), d.deviceCert(), Timestamp.from(now));
        return new DeviceView(d.deviceId(), d.devicePubkey(), d.deviceCert(), now, false);
    }

    @GetMapping("/v1/devices")
    public List<DeviceView> devices(@AuthenticationPrincipal Jwt jwt) {
        return jdbc.query("SELECT id, device_pubkey, device_cert, created_at, revoked_at FROM devices WHERE user_id = ? ORDER BY created_at",
                (rs, i) -> new DeviceView(Ids.uuid(rs.getBytes(1)), rs.getBytes(2), rs.getBytes(3),
                        rs.getTimestamp(4).toInstant(), rs.getTimestamp(5) != null),
                (Object) me(jwt));
    }

    // ---------- identity keys ----------

    public record Identity(@NotNull @Size(min = 32, max = 32) byte[] x25519Pub,
            @NotNull @Size(min = 32, max = 32) byte[] ed25519Pub,
            @NotNull @Size(min = 64, max = 64) byte[] signature, @Min(1) @Max(255) int version) {}

    @GetMapping("/v1/users/{userId}/identity")
    public Identity identity(@PathVariable("userId") UUID userId) {
        return jdbc.query("SELECT x25519_pub, ed25519_pub, signature, version FROM identity_keys WHERE user_id = ?",
                        (rs, i) -> new Identity(rs.getBytes(1), rs.getBytes(2), rs.getBytes(3), rs.getInt(4)),
                        (Object) Ids.bytes(userId))
                .stream().findFirst().orElseThrow(ApiException::notFound);
    }

    /** Publishes a new identity version (key rotation). Friends' apps warn on identity changes (CRYPTO.md 12). */
    @PutMapping("/v1/identity")
    @Transactional
    public Identity publishIdentity(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Identity k) {
        byte[] user = me(jwt);
        if (!core.verifyIdentity(k.ed25519Pub(), user, k.version(), k.x25519Pub(), k.signature())) {
            throw ApiException.badRequest("bad_identity_signature");
        }
        int n = jdbc.update("UPDATE identity_keys SET x25519_pub = ?, ed25519_pub = ?, signature = ?, version = ? WHERE user_id = ? AND version < ?",
                k.x25519Pub(), k.ed25519Pub(), k.signature(), k.version(), user, k.version());
        if (n != 1) {
            throw ApiException.conflict("version_conflict");
        }
        return k;
    }
}
