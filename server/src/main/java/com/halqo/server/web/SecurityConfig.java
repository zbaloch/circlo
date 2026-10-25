package com.halqo.server.web;

import com.halqo.server.config.ServerSecrets;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.www.BasicAuthenticationFilter;

/**
 * Stateless JWT auth (issuer {@code halqo-server}, audience {@code halqo-app}). Tokens carry scope {@code full} or
 * {@code recovery}; recovery tokens may only fetch the recovery backup and set a new password.
 */
@Configuration
public class SecurityConfig {

    static final String ISSUER = "halqo-server";
    static final String AUDIENCE = "halqo-app";

    @Bean
    SecurityFilterChain api(HttpSecurity http, AuthRateLimitFilter rateLimit) throws Exception {
        http.csrf(c -> c.disable())
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .httpBasic(b -> b.disable())
                .formLogin(f -> f.disable())
                .logout(l -> l.disable())
                .requestCache(r -> r.disable())
                .addFilterBefore(rateLimit, BasicAuthenticationFilter.class)
                .authorizeHttpRequests(a -> a
                        .requestMatchers(HttpMethod.POST,
                                "/v1/auth/register/start", "/v1/auth/register/finish",
                                "/v1/auth/login/start", "/v1/auth/login/finish",
                                "/v1/auth/refresh",
                                "/v1/auth/recovery/start", "/v1/auth/recovery/finish").permitAll()
                        .requestMatchers("/dev/**").permitAll() // only exists in profile 'local'
                        .requestMatchers("/error").permitAll()
                        .requestMatchers(HttpMethod.GET, "/v1/backups/recovery").hasAnyAuthority("SCOPE_full", "SCOPE_recovery")
                        .requestMatchers("/v1/auth/password/**").hasAnyAuthority("SCOPE_full", "SCOPE_recovery")
                        .anyRequest().hasAuthority("SCOPE_full"))
                .oauth2ResourceServer(o -> o.jwt(j -> {}));
        return http.build();
    }

    @Bean
    JwtEncoder jwtEncoder(ServerSecrets secrets) {
        return new NimbusJwtEncoder(new ImmutableSecret<>(key(secrets)));
    }

    @Bean
    JwtDecoder jwtDecoder(ServerSecrets secrets) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(key(secrets)).macAlgorithm(MacAlgorithm.HS256).build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(ISSUER),
                jwt -> jwt.getAudience() != null && jwt.getAudience().contains(AUDIENCE)
                        ? OAuth2TokenValidatorResult.success()
                        : OAuth2TokenValidatorResult.failure(new org.springframework.security.oauth2.core.OAuth2Error("invalid_token"))));
        return decoder;
    }

    private static SecretKeySpec key(ServerSecrets secrets) {
        return new SecretKeySpec(secrets.jwtKey(), "HmacSHA256");
    }
}
