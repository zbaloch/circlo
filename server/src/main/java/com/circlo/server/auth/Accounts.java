package com.circlo.server.auth;

import com.circlo.server.web.ApiException;
import java.util.Locale;
import java.util.regex.Pattern;

/** Validation and normalization of what people type at signup and login. Pure. */
public final class Accounts {

    private Accounts() {}

    static final Pattern USERNAME = Pattern.compile("[a-z0-9_]{3,30}");
    // Deliberately loose: the verification code proves the address works.
    static final Pattern EMAIL = Pattern.compile("[^@\\s]+@[^@\\s]+\\.[^@\\s]+");
    static final int MIN_PASSWORD = 12;
    static final int MAX_PASSWORD = 128;

    /** Lowercase, without a leading @. Throws invalid_username. */
    public static String username(String raw) {
        String u = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
        if (u.startsWith("@")) {
            u = u.substring(1);
        }
        if (!USERNAME.matcher(u).matches()) {
            throw ApiException.badRequest("invalid_username");
        }
        return u;
    }

    /** Lowercase. Throws invalid_email. */
    public static String email(String raw) {
        String e = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
        if (e.length() > 254 || !EMAIL.matcher(e).matches()) {
            throw ApiException.badRequest("invalid_email");
        }
        return e;
    }

    /** Trimmed, 1–50 characters, no control characters. Throws invalid_name. */
    public static String name(String raw) {
        String n = raw == null ? "" : raw.strip();
        int length = n.codePointCount(0, n.length());
        if (length < 1 || length > 50 || n.codePoints().anyMatch(Character::isISOControl)) {
            throw ApiException.badRequest("invalid_name");
        }
        return n;
    }

    /** Up to 160 characters (line breaks allowed). Throws invalid_bio. */
    public static String bio(String raw) {
        String b = raw == null ? "" : raw.strip();
        if (b.codePointCount(0, b.length()) > 160 || b.codePoints().anyMatch(c -> Character.isISOControl(c) && c != '\n')) {
            throw ApiException.badRequest("invalid_bio");
        }
        return b;
    }

    /** 12–128 characters (strength is also checked in the app). Throws weak_password. */
    public static String password(String raw) {
        int length = raw == null ? 0 : raw.codePointCount(0, raw.length());
        if (length < MIN_PASSWORD || length > MAX_PASSWORD) {
            throw ApiException.badRequest("weak_password");
        }
        return raw;
    }

    /** What someone typed to log in: an email if it has an @ after the first character, otherwise a username. */
    static boolean looksLikeEmail(String login) {
        return login.indexOf('@') > 0;
    }
}
