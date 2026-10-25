package com.halqo.server.auth;

import com.halqo.server.config.AuthProperties;
import com.halqo.server.config.ServerSecrets;
import com.halqo.server.crypto.CoreException;
import com.halqo.server.crypto.HalqoCore;
import com.halqo.server.web.ApiException;
import com.halqo.server.web.Ids;
import com.halqo.server.web.RateLimiter;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Accounts and authentication (CRYPTO.md sections 5–7). The server never sees a password, a handle at rest, or any
 * private key; it stores the OPAQUE record, public keys and ciphertext backups.
 */
@Service
public class AuthService {

    static final int LOGIN_ATTEMPTS_PER_HANDLE_PER_MINUTE = 10;

    private final HalqoCore core;
    private final ServerSecrets secrets;
    private final AuthProperties props;
    private final JdbcTemplate jdbc;
    private final TokenService tokens;
    private final RateLimiter limiter;
    private final Clock clock = Clock.systemUTC();

    public AuthService(HalqoCore core, ServerSecrets secrets, AuthProperties props, JdbcTemplate jdbc,
            TokenService tokens, RateLimiter limiter) {
        this.core = core;
        this.secrets = secrets;
        this.props = props;
        this.jdbc = jdbc;
        this.tokens = tokens;
        this.limiter = limiter;
    }

    // ---------- helpers ----------

    record Handle(String normalized, byte[] lookup) {}

    Handle handle(String raw) {
        try {
            String n = core.normalizeHandle(raw);
            return new Handle(n, core.handleLookup(secrets.handleKey(), n));
        } catch (CoreException e) {
            throw ApiException.badRequest("invalid_handle");
        }
    }

    private record UserRow(byte[] id, String status, byte[] lookup, byte[] record, byte[] recoveryPubkey, Instant createdAt) {}

    private List<UserRow> userBy(String column, byte[] value) {
        return jdbc.query(
                "SELECT id, status, handle_lookup, opaque_record, recovery_pubkey, created_at FROM users WHERE " + column + " = ?",
                (rs, i) -> new UserRow(rs.getBytes(1), rs.getString(2), rs.getBytes(3), rs.getBytes(4), rs.getBytes(5),
                        rs.getTimestamp(6).toInstant()),
                value);
    }

    private UserRow activeUser(UUID id) {
        return userBy("id", Ids.bytes(id)).stream().filter(u -> u.status().equals("active")).findFirst()
                .orElseThrow(ApiException::unauthorized);
    }

    private Timestamp now() {
        return Timestamp.from(clock.instant());
    }

    // ---------- registration ----------

    public record RegisterStart(UUID userId, byte[] registrationResponse) {}

    @Transactional
    public RegisterStart registerStart(String rawHandle, byte[] request) {
        Handle h = handle(rawHandle);
        for (UserRow u : userBy("handle_lookup", h.lookup())) {
            boolean stalePending = u.status().equals("pending")
                    && u.createdAt().plus(props.pendingRegistrationTtl()).isBefore(clock.instant());
            if (!stalePending) {
                throw ApiException.conflict("handle_taken");
            }
            jdbc.update("DELETE FROM users WHERE id = ?", (Object) u.id());
        }
        UUID userId = Ids.newId();
        jdbc.update("INSERT INTO users (id, handle_lookup, status, created_at) VALUES (?, ?, 'pending', ?)",
                Ids.bytes(userId), h.lookup(), now());
        byte[] response = core.opaqueRegistrationStart(secrets.opaqueServerSetup(), h.lookup(), request);
        return new RegisterStart(userId, response);
    }

    public record IdentityKeys(byte[] x25519Pub, byte[] ed25519Pub, byte[] signature, int version) {}

    public record Device(UUID deviceId, byte[] devicePubkey, byte[] deviceCert) {}

    public record RegisterFinish(UUID userId, String handle, byte[] registrationUpload, byte[] recoveryPubkey,
            IdentityKeys identity, Device device, byte[] passwordBackup, byte[] recoveryBackup) {}

    @Transactional
    public TokenService.Tokens registerFinish(RegisterFinish r) {
        Handle h = handle(r.handle());
        UserRow u = userBy("id", Ids.bytes(r.userId())).stream()
                .filter(x -> x.status().equals("pending") && MessageDigest.isEqual(x.lookup(), h.lookup()))
                .filter(x -> x.createdAt().plus(props.pendingRegistrationTtl()).isAfter(clock.instant()))
                .findFirst()
                .orElseThrow(() -> ApiException.badRequest("registration_expired"));
        byte[] userId = u.id();
        verifyIdentity(userId, r.identity());
        verifyDevice(userId, r.identity().ed25519Pub(), r.device());
        byte[] record = core.opaqueRegistrationFinish(r.registrationUpload());

        jdbc.update("UPDATE users SET opaque_record = ?, recovery_pubkey = ?, status = 'active' WHERE id = ?",
                record, r.recoveryPubkey(), userId);
        jdbc.update("INSERT INTO identity_keys (user_id, x25519_pub, ed25519_pub, signature, version) VALUES (?, ?, ?, ?, ?)",
                userId, r.identity().x25519Pub(), r.identity().ed25519Pub(), r.identity().signature(), r.identity().version());
        jdbc.update("INSERT INTO devices (id, user_id, device_pubkey, device_cert, created_at) VALUES (?, ?, ?, ?, ?)",
                Ids.bytes(r.device().deviceId()), userId, r.device().devicePubkey(), r.device().deviceCert(), now());
        jdbc.update("INSERT INTO key_backups (user_id, kind, ciphertext, version) VALUES (?, 'password', ?, 1), (?, 'recovery', ?, 1)",
                userId, r.passwordBackup(), userId, r.recoveryBackup());
        return tokens.issue(r.userId(), TokenService.Scope.full);
    }

    void verifyIdentity(byte[] userId, IdentityKeys k) {
        if (!core.verifyIdentity(k.ed25519Pub(), userId, k.version(), k.x25519Pub(), k.signature())) {
            throw ApiException.badRequest("bad_identity_signature");
        }
    }

    void verifyDevice(byte[] userId, byte[] identityEd25519Pub, Device d) {
        if (!core.verifyDeviceCertificate(identityEd25519Pub, userId, Ids.bytes(d.deviceId()), d.devicePubkey(), d.deviceCert())) {
            throw ApiException.badRequest("bad_device_certificate");
        }
    }

    // ---------- login ----------

    public record LoginStart(UUID loginId, byte[] credentialResponse) {}

    @Transactional
    public LoginStart loginStart(String rawHandle, byte[] request) {
        Handle h = handle(rawHandle);
        if (!limiter.tryAcquire("login-handle", h.lookup(), LOGIN_ATTEMPTS_PER_HANDLE_PER_MINUTE, 60_000)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited");
        }
        UserRow u = userBy("handle_lookup", h.lookup()).stream().filter(x -> x.status().equals("active")).findFirst()
                .orElse(null);
        HalqoCore.LoginStart ls = core.opaqueLoginStart(secrets.opaqueServerSetup(), u == null ? null : u.record(),
                h.lookup(), h.normalized(), request);
        UUID loginId = Ids.newId();
        jdbc.update("INSERT INTO opaque_login_states (id, user_id, state, expires_at) VALUES (?, ?, ?, ?)",
                Ids.bytes(loginId), u == null ? null : u.id(), ls.state(),
                Timestamp.from(clock.instant().plus(props.challengeTtl())));
        return new LoginStart(loginId, ls.response());
    }

    @Transactional
    public TokenService.Tokens loginFinish(UUID loginId, String rawHandle, byte[] finalization) {
        Handle h = handle(rawHandle);
        byte[] id = Ids.bytes(loginId);
        List<Object[]> rows = jdbc.query(
                "SELECT user_id, state, expires_at FROM opaque_login_states WHERE id = ? FOR UPDATE",
                (rs, i) -> new Object[] {rs.getBytes(1), rs.getBytes(2), rs.getTimestamp(3).toInstant()}, (Object) id);
        jdbc.update("DELETE FROM opaque_login_states WHERE id = ?", (Object) id); // single use, whatever happens next
        if (rows.isEmpty() || rows.get(0)[0] == null || ((Instant) rows.get(0)[2]).isBefore(clock.instant())) {
            throw ApiException.unauthorized();
        }
        UserRow u = activeUser(Ids.uuid((byte[]) rows.get(0)[0]));
        if (!MessageDigest.isEqual(u.lookup(), h.lookup())
                || !core.opaqueLoginFinish((byte[]) rows.get(0)[1], h.normalized(), finalization)) {
            throw ApiException.unauthorized();
        }
        return tokens.issue(Ids.uuid(u.id()), TokenService.Scope.full);
    }

    // ---------- recovery ----------

    public record RecoveryStart(UUID userId, UUID challengeId, byte[] nonce, long expiresAt) {}

    @Transactional
    public RecoveryStart recoveryStart(String rawHandle) {
        Handle h = handle(rawHandle);
        if (!limiter.tryAcquire("recovery-handle", h.lookup(), LOGIN_ATTEMPTS_PER_HANDLE_PER_MINUTE, 60_000)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited");
        }
        UserRow u = userBy("handle_lookup", h.lookup()).stream().filter(x -> x.status().equals("active")).findFirst()
                .orElse(null);
        // Unknown handles get a stable fake user id so the response shape never reveals whether an account exists.
        UUID userId = u != null ? Ids.uuid(u.id()) : fakeUserId(h.lookup());
        UUID challengeId = Ids.newId();
        byte[] nonce = Ids.random(32);
        Instant expires = clock.instant().plus(props.challengeTtl());
        jdbc.update("INSERT INTO recovery_challenges (id, user_id, nonce, expires_at) VALUES (?, ?, ?, ?)",
                Ids.bytes(challengeId), u == null ? null : u.id(), nonce, Timestamp.from(expires));
        return new RecoveryStart(userId, challengeId, nonce, expires.getEpochSecond());
    }

    private UUID fakeUserId(byte[] lookup) {
        return Ids.uuid(Arrays.copyOf(TokenService.sha256(concat("halqo/v1/fake-user".getBytes(), lookup)), 16));
    }

    private static byte[] concat(byte[] a, byte[] b) {
        byte[] out = Arrays.copyOf(a, a.length + b.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    @Transactional
    public TokenService.Tokens recoveryFinish(UUID challengeId, byte[] signature) {
        byte[] id = Ids.bytes(challengeId);
        List<Object[]> rows = jdbc.query(
                "SELECT user_id, nonce, expires_at FROM recovery_challenges WHERE id = ? FOR UPDATE",
                (rs, i) -> new Object[] {rs.getBytes(1), rs.getBytes(2), rs.getTimestamp(3).toInstant()}, (Object) id);
        jdbc.update("DELETE FROM recovery_challenges WHERE id = ?", (Object) id);
        if (rows.isEmpty() || rows.get(0)[0] == null) {
            throw ApiException.unauthorized();
        }
        Instant expires = (Instant) rows.get(0)[2];
        if (expires.isBefore(clock.instant())) {
            throw ApiException.unauthorized();
        }
        UserRow u = activeUser(Ids.uuid((byte[]) rows.get(0)[0]));
        if (u.recoveryPubkey() == null || !core.verifyRecoveryLogin(u.recoveryPubkey(), u.id(), id,
                (byte[]) rows.get(0)[1], expires.getEpochSecond(), signature)) {
            throw ApiException.unauthorized();
        }
        return tokens.issue(Ids.uuid(u.id()), TokenService.Scope.recovery);
    }

    // ---------- password change (also completes recovery) ----------

    @Transactional(readOnly = true)
    public byte[] passwordStart(UUID userId, String rawHandle, byte[] request) {
        Handle h = handle(rawHandle);
        UserRow u = activeUser(userId);
        if (!MessageDigest.isEqual(u.lookup(), h.lookup())) {
            throw ApiException.forbidden();
        }
        return core.opaqueRegistrationStart(secrets.opaqueServerSetup(), h.lookup(), request);
    }

    @Transactional
    public TokenService.Tokens passwordFinish(UUID userId, byte[] registrationUpload, byte[] passwordBackup) {
        UserRow u = activeUser(userId);
        byte[] record = core.opaqueRegistrationFinish(registrationUpload);
        jdbc.update("UPDATE users SET opaque_record = ? WHERE id = ?", record, u.id());
        jdbc.update("UPDATE key_backups SET ciphertext = ?, version = version + 1 WHERE user_id = ? AND kind = 'password'",
                passwordBackup, u.id());
        tokens.revokeAll(userId);
        return tokens.issue(userId, TokenService.Scope.full);
    }

    /** Housekeeping: expired login states and challenges. */
    @Transactional
    public void purgeExpired() {
        Timestamp now = now();
        jdbc.update("DELETE FROM opaque_login_states WHERE expires_at < ?", now);
        jdbc.update("DELETE FROM recovery_challenges WHERE expires_at < ?", now);
        jdbc.update("DELETE FROM refresh_tokens WHERE expires_at < ?", now);
    }
}
