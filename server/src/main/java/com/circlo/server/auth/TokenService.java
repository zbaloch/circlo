package com.circlo.server.auth;

import com.circlo.server.config.AuthProperties;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Sessions: each sign-in creates a device (an app install or a browser) with a short-lived access JWT and a rotating
 * refresh token, stored only as its SHA-256 hash. Revoking a device ends its sessions.
 */
@Service
public class TokenService {

    /** JWT claim naming the device a session belongs to. */
    public static final String DEVICE_CLAIM = "did";

    public record Tokens(UUID userId, UUID deviceId, String accessToken, String refreshToken, long expiresIn) {}

    private final JwtEncoder encoder;
    private final JdbcTemplate jdbc;
    private final AuthProperties props;
    private final Clock clock = Clock.systemUTC();

    public TokenService(JwtEncoder encoder, JdbcTemplate jdbc, AuthProperties props) {
        this.encoder = encoder;
        this.jdbc = jdbc;
        this.props = props;
    }

    /** A new signed-in device for this user, with its first tokens. */
    @Transactional
    public Tokens signIn(UUID userId) {
        UUID deviceId = Ids.newId();
        jdbc.update("INSERT INTO devices (id, user_id, created_at) VALUES (?, ?, ?)", Ids.bytes(deviceId), Ids.bytes(userId),
                Timestamp.from(clock.instant()));
        return issue(userId, deviceId);
    }

    @Transactional
    public Tokens issue(UUID userId, UUID deviceId) {
        Instant now = clock.instant();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("circlo-server")
                .audience(List.of("circlo-app"))
                .subject(userId.toString())
                .issuedAt(now)
                .expiresAt(now.plus(props.accessTtl()))
                .claim(DEVICE_CLAIM, deviceId.toString())
                .build();
        String access = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
                .getTokenValue();

        byte[] refresh = Ids.random(32);
        jdbc.update(
                "INSERT INTO refresh_tokens (token_hash, user_id, device_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
                sha256(refresh), Ids.bytes(userId), Ids.bytes(deviceId), Timestamp.from(now.plus(props.refreshTtl())),
                Timestamp.from(now));
        return new Tokens(userId, deviceId, access, Base64.getUrlEncoder().withoutPadding().encodeToString(refresh),
                props.accessTtl().toSeconds());
    }

    /**
     * Single use: the presented refresh token is revoked and a new pair issued for the same device. Presenting an
     * already-rotated token means it leaked (RFC 9700 section 4.14.2), so every session of that user is revoked; the 401
     * must not roll that back.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public Tokens refresh(String refreshToken) {
        byte[] raw;
        try {
            raw = Base64.getUrlDecoder().decode(refreshToken);
        } catch (IllegalArgumentException e) {
            throw ApiException.unauthorized();
        }
        byte[] hash = sha256(raw);
        Timestamp now = Timestamp.from(clock.instant());
        List<byte[][]> rows = jdbc.query("""
                SELECT t.user_id, t.device_id FROM refresh_tokens t
                JOIN devices d ON d.id = t.device_id JOIN users u ON u.id = t.user_id
                WHERE t.token_hash = ? AND t.revoked_at IS NULL AND t.expires_at > ? AND d.revoked_at IS NULL
                  AND u.status = 'active' FOR UPDATE""",
                (rs, i) -> new byte[][] {rs.getBytes(1), rs.getBytes(2)}, hash, now);
        if (rows.isEmpty()) {
            List<byte[]> reused = jdbc.query("SELECT user_id FROM refresh_tokens WHERE token_hash = ? AND rotated_at IS NOT NULL",
                    (rs, i) -> rs.getBytes(1), (Object) hash);
            if (!reused.isEmpty()) {
                revokeAll(Ids.uuid(reused.get(0)));
            }
            throw ApiException.unauthorized();
        }
        jdbc.update("UPDATE refresh_tokens SET revoked_at = ?, rotated_at = ? WHERE token_hash = ?", now, now, hash);
        return issue(Ids.uuid(rows.get(0)[0]), Ids.uuid(rows.get(0)[1]));
    }

    /** Signs out every device of this user (after a password reset, or a refresh token reused). */
    @Transactional
    public void revokeAll(UUID userId) {
        revokeAllExcept(userId, null);
    }

    /** Signs out every device of this user except `keep` (after a password change on `keep`). */
    @Transactional
    public void revokeAllExcept(UUID userId, UUID keep) {
        Timestamp now = Timestamp.from(clock.instant());
        byte[] kept = keep == null ? new byte[16] : Ids.bytes(keep);
        jdbc.update("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND device_id <> ? AND revoked_at IS NULL",
                now, Ids.bytes(userId), kept);
        jdbc.update("UPDATE devices SET revoked_at = ?, check_token_hash = NULL WHERE user_id = ? AND id <> ? AND revoked_at IS NULL",
                now, Ids.bytes(userId), kept);
    }

    /** Signs out one device. Returns false if it isn't one of this user's signed-in devices. */
    @Transactional
    public boolean revokeDevice(UUID userId, UUID deviceId) {
        Timestamp now = Timestamp.from(clock.instant());
        int n = jdbc.update("UPDATE devices SET revoked_at = ?, check_token_hash = NULL WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
                now, Ids.bytes(deviceId), Ids.bytes(userId));
        if (n == 1) {
            jdbc.update("UPDATE refresh_tokens SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL", now, Ids.bytes(deviceId));
        }
        return n == 1;
    }

    public static UUID userOf(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }

    public static UUID deviceOf(Jwt jwt) {
        return UUID.fromString(jwt.getClaimAsString(DEVICE_CLAIM));
    }

    public static byte[] sha256(byte[] b) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(b);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
