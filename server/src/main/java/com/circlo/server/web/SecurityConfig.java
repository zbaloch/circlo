package com.circlo.server.web;

import com.circlo.server.config.ServerSecrets;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.util.Arrays;
import java.util.List;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.beans.factory.annotation.Value;
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
import org.springframework.security.oauth2.server.resource.web.BearerTokenResolver;
import org.springframework.security.oauth2.server.resource.web.DefaultBearerTokenResolver;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.www.BasicAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * Stateless JWT auth (issuer {@code circlo-server}, audience {@code circlo-app}). Tokens travel in the Authorization
 * header, never cookies, so there is no CSRF to defend against. The web app's origin (e.g. https://app.hellocirclo.com)
 * must be listed in CIRCLO_CORS_ORIGINS.
 */
@Configuration
public class SecurityConfig {

    static final String ISSUER = "circlo-server";
    static final String AUDIENCE = "circlo-app";

    /** Public endpoints: signup, login, refresh, password reset, and the background check (its own token). */
    static final String[] PUBLIC_POSTS = {
        "/v1/auth/signup", "/v1/auth/signup/resend", "/v1/auth/signup/verify", "/v1/auth/login", "/v1/auth/refresh",
        "/v1/auth/password/forgot", "/v1/auth/password/reset",
    };

    @Bean
    SecurityFilterChain api(HttpSecurity http, AuthRateLimitFilter rateLimit) throws Exception {
        http.csrf(c -> c.disable())
                .cors(c -> {})
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .httpBasic(b -> b.disable())
                .formLogin(f -> f.disable())
                .logout(l -> l.disable())
                .requestCache(r -> r.disable())
                .addFilterBefore(rateLimit, BasicAuthenticationFilter.class)
                .authorizeHttpRequests(a -> a
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers(HttpMethod.POST, PUBLIC_POSTS).permitAll()
                        // Background checks: authenticated by the device's check token instead (ActivityController).
                        .requestMatchers(HttpMethod.GET, "/v1/activity/pending").permitAll()
                        .requestMatchers("/dev/**").permitAll() // only exists in profile 'local'
                        .requestMatchers("/error").permitAll()
                        .anyRequest().authenticated())
                .oauth2ResourceServer(o -> o.bearerTokenResolver(publicEndpointsIgnoreBearer()).jwt(j -> {}));
        return http.build();
    }

    /**
     * The public endpoints ignore any Bearer header. Clients refresh because their access token expired, so it may
     * still be attached; validating it would answer 401 before the endpoint runs and look like a revoked session.
     */
    static BearerTokenResolver publicEndpointsIgnoreBearer() {
        DefaultBearerTokenResolver standard = new DefaultBearerTokenResolver();
        List<String> open = Arrays.asList(PUBLIC_POSTS);
        return request -> {
            String uri = request.getRequestURI();
            return open.contains(uri) || uri.equals("/v1/activity/pending") ? null : standard.resolve(request);
        };
    }

    /** Browser access for the web app. Native apps don't send an Origin header and aren't affected. */
    @Bean
    CorsConfigurationSource corsConfigurationSource(@Value("${circlo.cors.origins:}") List<String> origins) {
        CorsConfiguration c = new CorsConfiguration();
        c.setAllowedOrigins(origins.stream().map(String::trim).filter(s -> !s.isEmpty()).toList());
        c.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE"));
        c.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Circlo-Check-Token"));
        c.setExposedHeaders(List.of("Retry-After"));
        c.setAllowCredentials(false);
        c.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/v1/**", c);
        return source;
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
                jwt -> jwt.getAudience() != null && jwt.getAudience().contains(AUDIENCE) && jwt.hasClaim("did")
                        ? OAuth2TokenValidatorResult.success()
                        : OAuth2TokenValidatorResult.failure(new org.springframework.security.oauth2.core.OAuth2Error("invalid_token"))));
        return decoder;
    }

    private static SecretKeySpec key(ServerSecrets secrets) {
        return new SecretKeySpec(secrets.jwtKey(), "HmacSHA256");
    }
}
