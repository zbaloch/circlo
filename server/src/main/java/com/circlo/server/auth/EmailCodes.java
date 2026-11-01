package com.circlo.server.auth;

import com.circlo.server.config.AuthProperties;
import com.circlo.server.mail.EmailSender;
import com.circlo.server.web.ApiException;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * One-time 6-digit codes sent by email: verifying a new account, or resetting a forgotten password. Only a hash is
 * stored; a code lasts {@code circlo.auth.code-ttl} (15 minutes), allows {@link #MAX_ATTEMPTS} wrong guesses, works
 * once, and a new code replaces the previous one.
 */
@Component
public class EmailCodes {

    public enum Purpose { verify, reset }

    static final int MAX_ATTEMPTS = 5;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final JdbcTemplate jdbc;
    private final EmailSender mail;
    private final AuthProperties props;
    private final Clock clock = Clock.systemUTC();

    public EmailCodes(JdbcTemplate jdbc, EmailSender mail, AuthProperties props) {
        this.jdbc = jdbc;
        this.mail = mail;
        this.props = props;
    }

    static byte[] hash(byte[] userId, Purpose purpose, String code) {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        b.writeBytes(userId);
        b.writeBytes(purpose.name().getBytes(StandardCharsets.US_ASCII));
        b.write(0);
        b.writeBytes(code.getBytes(StandardCharsets.US_ASCII));
        return TokenService.sha256(b.toByteArray());
    }

    /** Creates a fresh code for this user and purpose and emails it. */
    public void send(byte[] userId, String email, String name, Purpose purpose) {
        String code = String.format("%06d", RANDOM.nextInt(1_000_000));
        Instant now = clock.instant();
        jdbc.update("""
                INSERT INTO email_codes (user_id, purpose, code_hash, attempts, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?)
                ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), attempts = 0, expires_at = VALUES(expires_at),
                    created_at = VALUES(created_at)""",
                userId, purpose.name(), hash(userId, purpose, code), Timestamp.from(now.plus(props.codeTtl())), Timestamp.from(now));
        long minutes = props.codeTtl().toMinutes();
        if (purpose == Purpose.verify) {
            mail.send(email, "Your Circlo code: " + code, """
                    Hi %s,

                    Your code to finish signing up for Circlo is:

                        %s

                    It works for %d minutes. If you didn't sign up, ignore this email and no account will be created.
                    """.formatted(name, code, minutes));
        } else {
            mail.send(email, "Reset your Circlo password: " + code, """
                    Hi %s,

                    Your code to reset your Circlo password is:

                        %s

                    It works for %d minutes. If you didn't ask for this, ignore this email: your password stays the same.
                    """.formatted(name, code, minutes));
        }
    }

    /**
     * Checks a code. A right code is used up; a wrong one counts an attempt, and after {@link #MAX_ATTEMPTS} the code
     * stops working. Throws invalid_code (wrong, used up or unknown) or code_expired. Call inside a transaction that
     * doesn't roll back on {@link ApiException}, so wrong guesses are counted.
     */
    public void consume(byte[] userId, Purpose purpose, String code) {
        String typed = code == null ? "" : code.trim();
        if (!typed.matches("\\d{6}")) {
            throw ApiException.badRequest("invalid_code");
        }
        List<Object[]> rows = jdbc.query(
                "SELECT code_hash, attempts, expires_at FROM email_codes WHERE user_id = ? AND purpose = ? FOR UPDATE",
                (rs, i) -> new Object[] {rs.getBytes(1), rs.getInt(2), rs.getTimestamp(3).toInstant()}, userId, purpose.name());
        if (rows.isEmpty() || (Integer) rows.get(0)[1] >= MAX_ATTEMPTS) {
            throw ApiException.badRequest("invalid_code");
        }
        if (((Instant) rows.get(0)[2]).isBefore(clock.instant())) {
            throw ApiException.badRequest("code_expired");
        }
        if (!MessageDigest.isEqual((byte[]) rows.get(0)[0], hash(userId, purpose, typed))) {
            jdbc.update("UPDATE email_codes SET attempts = attempts + 1 WHERE user_id = ? AND purpose = ?", userId, purpose.name());
            throw ApiException.badRequest("invalid_code");
        }
        jdbc.update("DELETE FROM email_codes WHERE user_id = ? AND purpose = ?", userId, purpose.name());
    }

    @Scheduled(fixedDelay = 600_000, initialDelay = 60_000)
    void purgeExpired() {
        try {
            jdbc.update("DELETE FROM email_codes WHERE expires_at < ?", Timestamp.from(clock.instant()));
        } catch (RuntimeException e) {
            // next run
        }
    }
}
