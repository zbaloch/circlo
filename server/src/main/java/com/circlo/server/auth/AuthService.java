package com.circlo.server.auth;

import com.circlo.server.social.CircleController;
import com.circlo.server.notify.SecurityEmails;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import com.circlo.server.web.LockedException;
import com.circlo.server.web.RateLimiter;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Accounts and sign-in: signup with a name, username, email and password; the email is verified with a code before
 * the account exists; login with the username or email; password reset by an emailed code. Passwords are kept only
 * as Argon2id hashes. Nothing here is logged.
 */
@Service
public class AuthService {

    /** Codes emailed to one address per hour (signup, resend, reset). */
    static final int CODES_PER_EMAIL_PER_HOUR = 5;

    private final JdbcTemplate jdbc;
    private final TokenService tokens;
    private final PasswordHasher passwords;
    private final EmailCodes codes;
    private final LoginThrottle throttle;
    private final RateLimiter limiter;
    private final SecurityEmails security;
    private final Clock clock = Clock.systemUTC();

    public AuthService(JdbcTemplate jdbc, TokenService tokens, PasswordHasher passwords, EmailCodes codes, LoginThrottle throttle,
            RateLimiter limiter, SecurityEmails security) {
        this.jdbc = jdbc;
        this.security = security;
        this.tokens = tokens;
        this.passwords = passwords;
        this.codes = codes;
        this.throttle = throttle;
        this.limiter = limiter;
    }

    record User(byte[] id, String name, String username, String email, String passwordHash, String status) {
        UUID uuid() {
            return Ids.uuid(id);
        }

        /** For greetings in emails: the name, or the username while none is set. */
        String displayName() {
            return Accounts.displayName(name, username);
        }

        boolean active() {
            return status.equals("active");
        }
    }

    private List<User> usersWhere(String where, Object... args) {
        return jdbc.query("SELECT id, name, username, email, password_hash, status FROM users WHERE " + where,
                (rs, i) -> new User(rs.getBytes(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6)),
                args);
    }

    private User activeUser(UUID id) {
        return usersWhere("id = ? AND status = 'active'", (Object) Ids.bytes(id)).stream().findFirst().orElseThrow(ApiException::unauthorized);
    }

    private Timestamp now() {
        return Timestamp.from(clock.instant());
    }

    /** At most a few codes per address per hour, so Circlo can't be used to flood someone's inbox. */
    private boolean mayEmail(String email) {
        return limiter.tryAcquire("email-codes", email.getBytes(StandardCharsets.UTF_8), CODES_PER_EMAIL_PER_HOUR, 3_600_000);
    }

    // ---------- signup ----------

    public record SignupStarted(String email) {}

    /**
     * Starts a signup: reserves nothing until the email is verified (a pending signup with the same username or email is
     * replaced), and emails a code. Usernames and emails of existing accounts are refused.
     */
    @Transactional
    public SignupStarted signup(String rawUsername, String rawEmail, String rawPassword) {
        String username = Accounts.username(rawUsername);
        String email = Accounts.email(rawEmail);
        String password = Accounts.password(rawPassword);
        if (!usersWhere("username = ? AND status = 'active'", username).isEmpty()) {
            throw ApiException.conflict("username_taken");
        }
        if (!usersWhere("email = ? AND status = 'active'", email).isEmpty()) {
            throw ApiException.conflict("email_taken");
        }
        if (!mayEmail(email)) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "rate_limited");
        }
        // An unfinished signup isn't an account: starting again (or someone else choosing the same name) replaces it.
        jdbc.update("DELETE FROM users WHERE status = 'pending' AND (username = ? OR email = ?)", username, email);
        byte[] id = Ids.bytes(Ids.newId());
        jdbc.update("INSERT INTO users (id, username, email, password_hash, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
                id, username, email, passwords.hash(password), now());
        codes.send(id, email, username, EmailCodes.Purpose.verify);
        return new SignupStarted(email);
    }

    /** Sends a new code for an unfinished signup. Says nothing about whether one exists. */
    @Transactional
    public void resendVerification(String rawEmail) {
        String email = Accounts.email(rawEmail);
        for (User u : usersWhere("email = ? AND status = 'pending'", email)) {
            if (mayEmail(email)) {
                codes.send(u.id(), u.email(), u.displayName(), EmailCodes.Purpose.verify);
            }
        }
    }

    /** Finishes a signup with the emailed code: the account becomes active and this device is signed in. */
    @Transactional(noRollbackFor = ApiException.class)
    public TokenService.Tokens verifySignup(String rawEmail, String code) {
        String email = Accounts.email(rawEmail);
        User u = usersWhere("email = ? AND status = 'pending' FOR UPDATE", email).stream().findFirst()
                .orElseThrow(() -> ApiException.badRequest("invalid_code"));
        codes.consume(u.id(), EmailCodes.Purpose.verify, code);
        // Someone else may have verified the same username or email first.
        if (!usersWhere("(username = ? OR email = ?) AND status = 'active'", u.username(), u.email()).isEmpty()) {
            jdbc.update("DELETE FROM users WHERE id = ?", (Object) u.id());
            throw ApiException.conflict(usersWhere("username = ? AND status = 'active'", u.username()).isEmpty() ? "email_taken" : "username_taken");
        }
        jdbc.update("UPDATE users SET status = 'active', email_verified_at = ? WHERE id = ?", now(), u.id());
        CircleController.createStarterCircles(jdbc, u.id());
        return tokens.signIn(u.uuid());
    }

    // ---------- login ----------

    static byte[] throttleKey(User user, String typed) {
        String key = user != null ? "user:" + user.uuid() : "login:" + typed;
        return TokenService.sha256(key.getBytes(StandardCharsets.UTF_8));
    }

    private User findByLogin(String typed) {
        String login = typed == null ? "" : typed.trim().toLowerCase(java.util.Locale.ROOT);
        if (login.startsWith("@")) {
            login = login.substring(1);
        }
        String column = Accounts.looksLikeEmail(login) ? "email" : "username";
        // An active account wins over a pending signup that reuses its username or email.
        return usersWhere(column + " = ? ORDER BY status = 'active' DESC LIMIT 1", login).stream().findFirst().orElse(null);
    }

    /**
     * Logs in with a username or email and password. A wrong password answers 401 with how many attempts are left
     * before login locks (and the lock, at 0); unknown accounts answer exactly the same. An account whose email isn't
     * verified yet gets a fresh code and 403 email_not_verified.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public TokenService.Tokens login(String typed, String password) {
        String normalized = typed == null ? "" : typed.trim().toLowerCase(java.util.Locale.ROOT);
        User u = findByLogin(normalized);
        byte[] key = throttleKey(u, normalized);
        Instant locked = throttle.lockedUntil(key);
        if (locked != null) {
            throw new LockedException(Math.max(1, Duration.between(clock.instant(), locked).toSeconds()));
        }
        boolean ok;
        if (u == null || password == null) {
            passwords.burn(password == null ? "" : password);
            ok = false;
        } else {
            ok = passwords.matches(password, u.passwordHash());
        }
        if (!ok) {
            LoginThrottle.Decision d = throttle.fail(key);
            Long lockSeconds = d.lockedUntil() == null ? null : Duration.between(clock.instant(), d.lockedUntil()).toSeconds();
            throw new ApiException(HttpStatus.UNAUTHORIZED, "unauthorized",
                    lockSeconds == null ? Map.of("attemptsLeft", d.attemptsLeft()) : Map.of("attemptsLeft", d.attemptsLeft(), "lockSeconds", lockSeconds));
        }
        throttle.clear(key);
        if (!u.active()) {
            if (mayEmail(u.email())) {
                codes.send(u.id(), u.email(), u.displayName(), EmailCodes.Purpose.verify);
            }
            throw new ApiException(HttpStatus.FORBIDDEN, "email_not_verified", Map.of("email", u.email()));
        }
        // Shown on the account's other devices ("New sign-in") and emailed, with no detail about this one.
        jdbc.update("INSERT INTO security_events (id, user_id, kind, created_at) VALUES (?, ?, 'sign_in', ?)",
                Ids.bytes(Ids.newId()), u.id(), now());
        security.signIn(u.id());
        return tokens.signIn(u.uuid());
    }

    // ---------- forgotten password ----------

    /** Emails a reset code if an account uses this address. Says nothing about whether one does. */
    @Transactional
    public void forgotPassword(String rawEmail) {
        String email = Accounts.email(rawEmail);
        for (User u : usersWhere("email = ? AND status = 'active'", email)) {
            if (mayEmail(email)) {
                codes.send(u.id(), u.email(), u.displayName(), EmailCodes.Purpose.reset);
            }
        }
    }

    /** Sets a new password with the emailed code: every other session ends, any login lock lifts, this device signs in. */
    @Transactional(noRollbackFor = ApiException.class)
    public TokenService.Tokens resetPassword(String rawEmail, String code, String rawPassword) {
        String email = Accounts.email(rawEmail);
        String password = Accounts.password(rawPassword);
        User u = usersWhere("email = ? AND status = 'active' FOR UPDATE", email).stream().findFirst()
                .orElseThrow(() -> ApiException.badRequest("invalid_code"));
        codes.consume(u.id(), EmailCodes.Purpose.reset, code);
        jdbc.update("UPDATE users SET password_hash = ? WHERE id = ?", passwords.hash(password), u.id());
        security.passwordChanged(u.id());
        throttle.clear(throttleKey(u, null));
        tokens.revokeAll(u.uuid());
        return tokens.signIn(u.uuid());
    }

    // ---------- changing the password (signed in) ----------

    /**
     * Checks the current password (a wrong one counts towards the login lock) and sets the new one. Every other device
     * is signed out; this one gets fresh tokens.
     */
    @Transactional(noRollbackFor = ApiException.class)
    public TokenService.Tokens changePassword(UUID userId, UUID deviceId, String current, String rawNext) {
        String next = Accounts.password(rawNext);
        User u = activeUser(userId);
        byte[] key = throttleKey(u, null);
        Instant locked = throttle.lockedUntil(key);
        if (locked != null) {
            throw new LockedException(Math.max(1, Duration.between(clock.instant(), locked).toSeconds()));
        }
        if (current == null || !passwords.matches(current, u.passwordHash())) {
            LoginThrottle.Decision d = throttle.fail(key);
            throw new ApiException(HttpStatus.FORBIDDEN, "wrong_password", Map.of("attemptsLeft", d.attemptsLeft()));
        }
        throttle.clear(key);
        jdbc.update("UPDATE users SET password_hash = ? WHERE id = ?", passwords.hash(next), u.id());
        security.passwordChanged(u.id());
        tokens.revokeAllExcept(userId, deviceId);
        return tokens.issue(userId, deviceId);
    }

    /** True if `password` is this user's password (account deletion asks for it). Wrong ones count towards the lock. */
    @Transactional(noRollbackFor = ApiException.class)
    public boolean confirmPassword(UUID userId, String password) {
        User u = activeUser(userId);
        byte[] key = throttleKey(u, null);
        if (throttle.lockedUntil(key) != null) {
            throw new LockedException(60);
        }
        if (password != null && passwords.matches(password, u.passwordHash())) {
            return true;
        }
        throttle.fail(key);
        return false;
    }

    /** Housekeeping: signups never verified, and expired refresh tokens. */
    @Transactional
    public void purgeExpired(Duration pendingTtl) {
        jdbc.update("DELETE FROM users WHERE status = 'pending' AND created_at < ?", Timestamp.from(clock.instant().minus(pendingTtl)));
        jdbc.update("DELETE FROM refresh_tokens WHERE expires_at < ?", now());
    }
}
