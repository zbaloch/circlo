package com.circlo.server.reading;

import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
import java.util.Locale;

/**
 * Reading fetches addresses people type, so Circlo must never be pointed at its own network (server-side request
 * forgery): only http and https, no user:password, and every address the host resolves to must be public. FeedHttp
 * checks again before each redirect. Tests serve feeds from localhost, which only the test profile allows
 * ({@code circlo.reading.allow-private-hosts}).
 *
 * <p>Accepted gap (docs/THREAT_MODEL.md): the JDK client resolves the host again when it connects, so a DNS answer
 * that changes between the check and the connection (DNS rebinding) isn't caught here; the edge firewall should keep
 * the server from reaching internal services anyway.
 */
public final class UrlGuard {

    /** An address Circlo won't fetch. Carries no detail: the reason is never shown or logged with the address. */
    public static final class Refused extends Exception {
        Refused() {
            super("refused", null, false, false);
        }
    }

    private UrlGuard() {}

    /**
     * What someone typed, as an absolute http(s) address: "example.com" becomes https://example.com, and feed:// is
     * https://. Null if it can't be one.
     */
    public static URI parseInput(String input) {
        if (input == null) {
            return null;
        }
        String s = input.strip();
        if (s.isEmpty() || s.length() > 2048 || s.chars().anyMatch(Character::isWhitespace)) {
            return null;
        }
        String lower = s.toLowerCase(Locale.ROOT);
        if (lower.startsWith("feed://")) {
            s = "https://" + s.substring(7);
        } else if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
            if (lower.contains(":") && !lower.matches("^[a-z0-9.-]+:\\d+(/.*)?$")) {
                return null; // another scheme (javascript:, file:, ...)
            }
            s = "https://" + s;
        }
        try {
            URI uri = new URI(s);
            return uri.getHost() == null || !uri.getHost().contains(".") && !uri.getHost().startsWith("[") ? null : uri;
        } catch (URISyntaxException e) {
            return null;
        }
    }

    /** The address, if Circlo may fetch it. */
    public static URI check(URI uri, boolean allowPrivate) throws Refused {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("http") && !scheme.equals("https") || uri.getHost() == null || uri.getRawUserInfo() != null) {
            throw new Refused();
        }
        if (allowPrivate) {
            return uri;
        }
        try {
            InetAddress[] all = InetAddress.getAllByName(uri.getHost());
            for (InetAddress a : all) {
                if (!isPublic(a)) {
                    throw new Refused();
                }
            }
        } catch (UnknownHostException e) {
            throw new Refused();
        }
        return uri;
    }

    /** Not loopback, private, link-local, shared, multicast, documentation or otherwise reserved. */
    public static boolean isPublic(InetAddress a) {
        if (a.isAnyLocalAddress() || a.isLoopbackAddress() || a.isLinkLocalAddress() || a.isSiteLocalAddress() || a.isMulticastAddress()) {
            return false;
        }
        byte[] b = a.getAddress();
        if (a instanceof Inet4Address) {
            return isPublicV4(b);
        }
        if (a instanceof Inet6Address) {
            int first = b[0] & 0xff;
            if ((first & 0xfe) == 0xfc) {
                return false; // fc00::/7 unique local
            }
            if (first == 0xfe && (b[1] & 0xc0) == 0xc0) {
                return false; // fec0::/10 old site-local
            }
            if (first == 0x20 && (b[1] & 0xff) == 0x01 && (b[2] & 0xff) == 0x0d && (b[3] & 0xff) == 0xb8) {
                return false; // 2001:db8::/32 documentation
            }
            // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::/96): judge the IPv4 part.
            boolean zeros10 = true;
            for (int i = 0; i < 10; i++) {
                zeros10 &= b[i] == 0;
            }
            boolean nat64 = (b[0] & 0xff) == 0x00 && (b[1] & 0xff) == 0x64 && (b[2] & 0xff) == 0xff && (b[3] & 0xff) == 0x9b;
            if (zeros10 || nat64) {
                return isPublicV4(new byte[] {b[12], b[13], b[14], b[15]}) && !nat64;
            }
            return true;
        }
        return false;
    }

    private static boolean isPublicV4(byte[] b) {
        int a0 = b[0] & 0xff;
        int a1 = b[1] & 0xff;
        int a2 = b[2] & 0xff;
        return !(a0 == 0 // this network
                || a0 == 10
                || a0 == 127
                || a0 == 100 && a1 >= 64 && a1 <= 127 // shared address space (CGNAT)
                || a0 == 169 && a1 == 254 // link-local, cloud metadata
                || a0 == 172 && a1 >= 16 && a1 <= 31
                || a0 == 192 && a1 == 0 && a2 == 0 // IETF protocol assignments
                || a0 == 192 && a1 == 0 && a2 == 2 // documentation
                || a0 == 192 && a1 == 168
                || a0 == 198 && (a1 == 18 || a1 == 19) // benchmarking
                || a0 == 198 && a1 == 51 && a2 == 100
                || a0 == 203 && a1 == 0 && a2 == 113
                || a0 >= 224); // multicast, reserved, broadcast
    }
}
