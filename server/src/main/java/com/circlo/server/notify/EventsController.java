package com.circlo.server.notify;

import com.circlo.server.auth.TokenService;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.async.DeferredResult;

/** Live updates for open apps (a long-held request), and this device's push token. */
@RestController
public class EventsController {

    static final long WAIT_MS = 25_000;

    private final Signals signals;
    private final PushTokens tokens;
    private final JdbcTemplate jdbc;

    public EventsController(Signals signals, PushTokens tokens, JdbcTemplate jdbc) {
        this.signals = signals;
        this.tokens = tokens;
        this.jdbc = jdbc;
    }

    /**
     * Answers with my current version as soon as it differs from `since` (at once if it already does), or after 25 s.
     * The app then refreshes whatever it shows; the answer itself says nothing about what changed.
     */
    @GetMapping("/v1/events")
    public DeferredResult<Map<String, Long>> events(@AuthenticationPrincipal Jwt jwt, @RequestParam("since") long since) {
        return signals.await(TokenService.userOf(jwt), since, WAIT_MS);
    }

    public record PushToken(@NotNull @Pattern(regexp = "[A-Za-z0-9_:.-]{1,200}") String token,
            @NotNull @Pattern(regexp = "apns|apns_sandbox") String service) {}

    /** Registers (or replaces) this device's push token. Signing out or revoking the device forgets it. */
    @PutMapping("/v1/devices/current/push-token")
    public Map<String, String> register(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody PushToken p) {
        byte[] device = Ids.bytes(TokenService.deviceOf(jwt));
        if (jdbc.update("UPDATE devices SET push_token_enc = ?, push_service = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
                tokens.seal(device, p.token()), p.service(), device, Ids.bytes(TokenService.userOf(jwt))) != 1) {
            throw ApiException.notFound();
        }
        return Map.of("status", "registered");
    }

    @DeleteMapping("/v1/devices/current/push-token")
    public Map<String, String> unregister(@AuthenticationPrincipal Jwt jwt) {
        jdbc.update("UPDATE devices SET push_token_enc = NULL, push_service = NULL WHERE id = ? AND user_id = ?",
                Ids.bytes(TokenService.deviceOf(jwt)), Ids.bytes(TokenService.userOf(jwt)));
        return Map.of("status", "unregistered");
    }
}
