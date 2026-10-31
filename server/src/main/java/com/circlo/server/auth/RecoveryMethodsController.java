package com.circlo.server.auth;

import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * A user's recovery methods (docs/PASSKEY_RECOVERY.md): Face ID (passkey) and/or a phrase. Settings lists them with no
 * keys or ciphertext, adds one (or another wrap of the passkey) with the session, and removes one only with a fresh proof
 * of the password, never the last one. A recovery session fetches the copy of the method that let it in.
 */
@RestController
public class RecoveryMethodsController {

    public static final String REAUTH = "X-Circlo-Reauth";

    private final JdbcTemplate jdbc;
    private final AuthService auth;

    public RecoveryMethodsController(JdbcTemplate jdbc, AuthService auth) {
        this.jdbc = jdbc;
        this.auth = auth;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(UUID.fromString(jwt.getSubject()));
    }

    public record Method(UUID id, String kind, Instant createdAt, Instant lastUsedAt) {}

    public record Methods(List<Method> methods) {}

    @GetMapping("/v1/recovery-methods")
    public Methods list(@AuthenticationPrincipal Jwt jwt) {
        return new Methods(jdbc.query(
                "SELECT id, kind, created_at, last_used_at FROM recovery_methods WHERE user_id = ? ORDER BY created_at",
                (rs, i) -> new Method(Ids.uuid(rs.getBytes(1)), rs.getString(2), rs.getTimestamp(3).toInstant(),
                        rs.getTimestamp(4) == null ? null : rs.getTimestamp(4).toInstant()),
                (Object) me(jwt)));
    }

    @PostMapping("/v1/recovery-methods")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, UUID> add(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody AuthController.RecoveryMethodDto m) {
        return Map.of("id", auth.addRecoveryMethod(me(jwt), m.toMethod()));
    }

    @DeleteMapping("/v1/recovery-methods/{id}")
    @Transactional
    public Map<String, String> remove(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id,
            @RequestHeader(value = REAUTH, required = false) String reauth) {
        byte[] me = me(jwt);
        if (jdbc.queryForList("SELECT 1 FROM recovery_methods WHERE id = ? AND user_id = ?", Ids.bytes(id), me).isEmpty()) {
            throw ApiException.notFound();
        }
        if (!auth.consumeReauth(UUID.fromString(jwt.getSubject()), reauth)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "reauth_required");
        }
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM recovery_methods WHERE user_id = ? FOR UPDATE", Integer.class, (Object) me);
        if (count == null || count <= 1) {
            throw ApiException.conflict("last_recovery_method");
        }
        jdbc.update("DELETE FROM recovery_methods WHERE id = ? AND user_id = ?", Ids.bytes(id), me);
        return Map.of("status", "removed");
    }

    public record Copy(byte[] ciphertext) {}

    /** The recovery copy of one of my methods: what a recovery session opens with the phrase or passkey. */
    @GetMapping("/v1/recovery-methods/{id}/backup")
    public Copy backup(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        return jdbc.query("SELECT ciphertext FROM recovery_methods WHERE id = ? AND user_id = ?",
                        (rs, i) -> new Copy(rs.getBytes(1)), Ids.bytes(id), me(jwt))
                .stream().findFirst().orElseThrow(ApiException::notFound);
    }
}
