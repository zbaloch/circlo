package com.halqo.server.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Limits unauthenticated auth endpoints per client address. The address is only hashed in memory
 * (see {@link RateLimiter}); it is never logged or stored.
 */
@Component
public class AuthRateLimitFilter extends OncePerRequestFilter {

    private final RateLimiter limiter;
    private final int limitPerMinute;

    public AuthRateLimitFilter(RateLimiter limiter, com.halqo.server.config.AuthProperties props) {
        this.limiter = limiter;
        this.limitPerMinute = props.ipRequestsPerMinute();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/v1/auth/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        byte[] client = String.valueOf(request.getRemoteAddr()).getBytes(StandardCharsets.UTF_8);
        if (!limiter.tryAcquire("auth-ip", client, limitPerMinute, 60_000)) {
            response.setStatus(429);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"rate_limited\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
