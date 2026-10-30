package com.circlo.server.auth;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Auth endpoints. Byte fields are base64 in JSON; IDs are UUID strings. Nothing here is logged. */
@RestController
@RequestMapping("/v1/auth")
public class AuthController {

    static final int MAX_BACKUP = 1 << 20;

    private final AuthService auth;
    private final TokenService tokens;

    public AuthController(AuthService auth, TokenService tokens) {
        this.auth = auth;
        this.tokens = tokens;
    }

    public record RegisterStartRequest(@NotBlank @Size(max = 64) String handle,
            @NotNull @Size(min = 1, max = 256) byte[] registrationRequest) {}

    public record IdentityDto(@NotNull @Size(min = 32, max = 32) byte[] x25519Pub,
            @NotNull @Size(min = 32, max = 32) byte[] ed25519Pub,
            @NotNull @Size(min = 64, max = 64) byte[] signature,
            @Min(1) @Max(255) int version) {
        AuthService.IdentityKeys toKeys() {
            return new AuthService.IdentityKeys(x25519Pub, ed25519Pub, signature, version);
        }
    }

    public record DeviceDto(@NotNull UUID deviceId,
            @NotNull @Size(min = 32, max = 32) byte[] devicePubkey,
            @NotNull @Size(min = 64, max = 64) byte[] deviceCert) {
        AuthService.Device toDevice() {
            return new AuthService.Device(deviceId, devicePubkey, deviceCert);
        }
    }

    public record RegisterFinishRequest(@NotNull UUID userId, @NotBlank @Size(max = 64) String handle,
            @NotNull @Size(min = 1, max = 512) byte[] registrationUpload,
            @NotNull @Size(min = 32, max = 32) byte[] recoveryPubkey,
            @NotNull @Valid IdentityDto identity, @NotNull @Valid DeviceDto device,
            @NotNull @Size(min = 1, max = MAX_BACKUP) byte[] passwordBackup,
            @NotNull @Size(min = 1, max = MAX_BACKUP) byte[] recoveryBackup) {}

    public record LoginStartRequest(@NotBlank @Size(max = 64) String handle,
            @NotNull @Size(min = 1, max = 512) byte[] credentialRequest) {}

    public record LoginFinishRequest(@NotNull UUID loginId, @NotBlank @Size(max = 64) String handle,
            @NotNull @Size(min = 1, max = 512) byte[] credentialFinalization) {}

    public record RefreshRequest(@NotBlank @Size(max = 128) String refreshToken) {}

    public record RecoveryStartRequest(@NotBlank @Size(max = 64) String handle) {}

    public record RecoveryFinishRequest(@NotNull UUID challengeId, @NotNull @Size(min = 64, max = 64) byte[] signature) {}

    public record PasswordStartRequest(@NotBlank @Size(max = 64) String handle,
            @NotNull @Size(min = 1, max = 256) byte[] registrationRequest) {}

    public record PasswordStartResponse(byte[] registrationResponse) {}

    public record PasswordFinishRequest(@NotNull @Size(min = 1, max = 512) byte[] registrationUpload,
            @NotNull @Size(min = 1, max = MAX_BACKUP) byte[] passwordBackup) {}

    @PostMapping("/register/start")
    public AuthService.RegisterStart registerStart(@Valid @RequestBody RegisterStartRequest r) {
        return auth.registerStart(r.handle(), r.registrationRequest());
    }

    @PostMapping("/register/finish")
    public TokenService.Tokens registerFinish(@Valid @RequestBody RegisterFinishRequest r) {
        return auth.registerFinish(new AuthService.RegisterFinish(r.userId(), r.handle(), r.registrationUpload(),
                r.recoveryPubkey(), r.identity().toKeys(), r.device().toDevice(), r.passwordBackup(), r.recoveryBackup()));
    }

    @PostMapping("/login/start")
    public AuthService.LoginStart loginStart(@Valid @RequestBody LoginStartRequest r) {
        return auth.loginStart(r.handle(), r.credentialRequest());
    }

    @PostMapping("/login/finish")
    public TokenService.Tokens loginFinish(@Valid @RequestBody LoginFinishRequest r) {
        return auth.loginFinish(r.loginId(), r.handle(), r.credentialFinalization());
    }

    @PostMapping("/refresh")
    public TokenService.Tokens refresh(@Valid @RequestBody RefreshRequest r) {
        return tokens.refresh(r.refreshToken());
    }

    @PostMapping("/recovery/start")
    public AuthService.RecoveryStart recoveryStart(@Valid @RequestBody RecoveryStartRequest r) {
        return auth.recoveryStart(r.handle());
    }

    @PostMapping("/recovery/finish")
    public TokenService.Tokens recoveryFinish(@Valid @RequestBody RecoveryFinishRequest r) {
        return auth.recoveryFinish(r.challengeId(), r.signature());
    }

    @PostMapping("/password/start")
    public PasswordStartResponse passwordStart(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody PasswordStartRequest r) {
        return new PasswordStartResponse(auth.passwordStart(UUID.fromString(jwt.getSubject()), r.handle(), r.registrationRequest()));
    }

    @PostMapping("/password/verify/start")
    public AuthService.LoginStart verifyStart(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody LoginStartRequest r) {
        return auth.verifyStart(UUID.fromString(jwt.getSubject()), r.handle(), r.credentialRequest());
    }

    @PostMapping("/password/verify/finish")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void verifyFinish(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody LoginFinishRequest r) {
        auth.verifyFinish(UUID.fromString(jwt.getSubject()), r.loginId(), r.handle(), r.credentialFinalization());
    }

    @PostMapping("/password/finish")
    public TokenService.Tokens passwordFinish(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody PasswordFinishRequest r) {
        return auth.passwordFinish(UUID.fromString(jwt.getSubject()), r.registrationUpload(), r.passwordBackup());
    }

    @Scheduled(fixedDelay = 60_000)
    void purge() {
        auth.purgeExpired();
    }
}
