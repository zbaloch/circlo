package com.halqo.server.auth;

import com.halqo.server.config.AuthProperties;
import com.halqo.server.web.ApiException;
import com.halqo.server.web.Ids;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Issues short-lived access JWTs and rotating refresh tokens (stored only as SHA-256 hashes). */
@Service
public class TokenService {

    public enum Scope { full, recovery }

    public record Tokens(UUID userId, String accessToken, String refreshToken, long expiresIn, Scope scope) {}

    private final JwtEncoder encoder;
    private final JdbcTemplate jdbc;
    private final AuthProperties props;
    private final Clock clock;

    public TokenService(JwtEncoder encoder, JdbcTemplate jdbc, AuthProperties props) {
        this.encoder = encoder;
        this.jdbc = jdbc;
        this.props = props;
        this.clock = Clock.systemUTC();
    }

    @Transactional
    public Tokens issue(UUID userId, Scope scope) {
        Instant now = clock.instant();
        Duration accessTtl = scope == Scope.full ? props.accessTtl() : props.recoveryTtl();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("halqo-server")
                .audience(List.of("halqo-app"))
                .subject(userId.toString())
                .issuedAt(now)
                .expiresAt(now.plus(accessTtl))
                .claim("scope", scope.name())
                .build();
        String access = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
                .getTokenValue();

        byte[] refresh = Ids.random(32);
        Duration refreshTtl = scope == Scope.full ? props.refreshTtl() : props.recoveryTtl();
        jdbc.update(
                "INSERT INTO refresh_tokens (token_hash, user_id, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
                sha256(refresh), Ids.bytes(userId), scope.name(), Timestamp.from(now.plus(refreshTtl)), Timestamp.from(now));
        return new Tokens(userId, access, Base64.getUrlEncoder().withoutPadding().encodeToString(refresh),
                accessTtl.toSeconds(), scope);
    }

    /** Single use: the presented refresh token is revoked and a new pair issued. Reuse of a revoked token fails. */
    @Transactional
    public Tokens refresh(String refreshToken) {
        byte[] raw;
        try {
            raw = Base64.getUrlDecoder().decode(refreshToken);
        } catch (IllegalArgumentException e) {
            throw ApiException.unauthorized();
        }
        byte[] hash = sha256(raw);
        Timestamp now = Timestamp.from(clock.instant());
        List<Object[]> rows = jdbc.query(
                "SELECT user_id, scope FROM refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? FOR UPDATE",
                (rs, i) -> new Object[] {rs.getBytes(1), rs.getString(2)}, hash, now);
        if (rows.isEmpty()) {
            throw ApiException.unauthorized();
        }
        jdbc.update("UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?", now, hash);
        return issue(Ids.uuid((byte[]) rows.get(0)[0]), Scope.valueOf((String) rows.get(0)[1]));
    }

    @Transactional
    public void revokeAll(UUID userId) {
        jdbc.update("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
                Timestamp.from(clock.instant()), Ids.bytes(userId));
    }

    static byte[] sha256(byte[] b) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(b);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
