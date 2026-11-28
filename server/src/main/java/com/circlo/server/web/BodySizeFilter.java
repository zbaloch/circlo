package com.circlo.server.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Caps every request body at {@link #MAX_BYTES}, before anything reads it, so a huge body (even to a signed-out
 * endpoint like login) can't fill the server's memory. The largest legitimate body is an OPML import (1 MB of text);
 * photos and videos go straight to storage with presigned links, never through here. A body that says it's too big
 * gets 413 at once; one sent without a length is cut off at the limit (and fails to parse).
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class BodySizeFilter extends OncePerRequestFilter {

    public static final long MAX_BYTES = 2L * 1024 * 1024;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (request.getContentLengthLong() > MAX_BYTES) {
            response.setStatus(413);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"too_large\"}");
            return;
        }
        chain.doFilter(new Limited(request), response);
    }

    /** The request, its body readable only up to the limit. */
    private static final class Limited extends HttpServletRequestWrapper {
        private ServletInputStream limited;

        Limited(HttpServletRequest request) {
            super(request);
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (limited == null) {
                ServletInputStream in = super.getInputStream();
                limited = new ServletInputStream() {
                    private long read;

                    private void count(long n) throws IOException {
                        read += n;
                        if (read > MAX_BYTES) {
                            throw new IOException("too_large");
                        }
                    }

                    @Override
                    public int read() throws IOException {
                        int b = in.read();
                        if (b >= 0) {
                            count(1);
                        }
                        return b;
                    }

                    @Override
                    public int read(byte[] buf, int off, int len) throws IOException {
                        int n = in.read(buf, off, len);
                        if (n > 0) {
                            count(n);
                        }
                        return n;
                    }

                    @Override
                    public boolean isFinished() {
                        return in.isFinished();
                    }

                    @Override
                    public boolean isReady() {
                        return in.isReady();
                    }

                    @Override
                    public void setReadListener(ReadListener listener) {
                        in.setReadListener(listener);
                    }
                };
            }
            return limited;
        }
    }
}
