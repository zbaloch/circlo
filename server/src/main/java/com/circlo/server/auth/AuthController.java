package com.circlo.server.auth;

import com.circlo.server.config.AuthProperties;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Signup, login, sessions and passwords. Nothing here is logged. */
@RestController
@RequestMapping("/v1/auth")
public class AuthController {

    private final AuthService auth;
    private final TokenService tokens;
    private final AuthProperties props;

    public AuthController(AuthService auth, TokenService tokens, AuthProperties props) {
        this.auth = auth;
        this.tokens = tokens;
        this.props = props;
    }

    public record SignupRequest(@NotNull @Size(max = 64) String username,
            @NotNull @Size(max = 254) String email, @NotNull @Size(max = 512) String password) {}

    public record EmailRequest(@NotNull @Size(max = 254) String email) {}

    public record VerifyRequest(@NotNull @Size(max = 254) String email, @NotNull @Size(max = 16) String code) {}

    public record LoginRequest(@NotNull @Size(max = 254) String login, @NotNull @Size(max = 512) String password) {}

    public record RefreshRequest(@NotBlank @Size(max = 128) String refreshToken) {}

    public record ResetRequest(@NotNull @Size(max = 254) String email, @NotNull @Size(max = 16) String code,
            @NotNull @Size(max = 512) String password) {}

    public record ChangePasswordRequest(@NotNull @Size(max = 512) String currentPassword, @NotNull @Size(max = 512) String newPassword) {}

    /** Starts a signup and emails a 6-digit code to verify the address. */
    @PostMapping("/signup")
    @ResponseStatus(HttpStatus.CREATED)
    public AuthService.SignupStarted signup(@Valid @RequestBody SignupRequest r) {
        return auth.signup(r.username(), r.email(), r.password());
    }

    @PostMapping("/signup/resend")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String, String> resend(@Valid @RequestBody EmailRequest r) {
        auth.resendVerification(r.email());
        return Map.of("status", "sent");
    }

    @PostMapping("/signup/verify")
    public TokenService.Tokens verify(@Valid @RequestBody VerifyRequest r) {
        return auth.verifySignup(r.email(), r.code());
    }

    @PostMapping("/login")
    public TokenService.Tokens login(@Valid @RequestBody LoginRequest r) {
        return auth.login(r.login(), r.password());
    }

    @PostMapping("/refresh")
    public TokenService.Tokens refresh(@Valid @RequestBody RefreshRequest r) {
        return tokens.refresh(r.refreshToken());
    }

    @PostMapping("/password/forgot")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String, String> forgot(@Valid @RequestBody EmailRequest r) {
        auth.forgotPassword(r.email());
        return Map.of("status", "sent");
    }

    @PostMapping("/password/reset")
    public TokenService.Tokens reset(@Valid @RequestBody ResetRequest r) {
        return auth.resetPassword(r.email(), r.code(), r.password());
    }

    /** Signed in: change the password. Other devices are signed out. */
    @PostMapping("/password/change")
    public TokenService.Tokens change(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ChangePasswordRequest r) {
        return auth.changePassword(TokenService.userOf(jwt), TokenService.deviceOf(jwt), r.currentPassword(), r.newPassword());
    }

    /** Signed in: sign this device out. */
    @PostMapping("/logout")
    public Map<String, String> logout(@AuthenticationPrincipal Jwt jwt) {
        tokens.revokeDevice(TokenService.userOf(jwt), TokenService.deviceOf(jwt));
        return Map.of("status", "signed_out");
    }

    @Scheduled(fixedDelay = 600_000, initialDelay = 60_000)
    void purge() {
        try {
            auth.purgeExpired(props.pendingSignupTtl());
        } catch (RuntimeException e) {
            // next run
        }
    }
}
