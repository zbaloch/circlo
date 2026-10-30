package com.circlo.server.auth;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Password login lockout, kept in the database so a restart doesn't reset it. With OPAQUE a wrong password fails on
 * the phone, so the server never sees the failure itself: every login start counts as a failed attempt until a login
 * finishes successfully. After {@link #MAX_ATTEMPTS} the next lock is set (15 minutes, then 1 hour, then 24 hours);
 * a day without attempts starts over. The recovery phrase is never locked out, and a successful password reset clears
 * the lock. Keyed by the handle lookup, and unknown handles behave exactly like real ones.
 */
@Component
public class LoginThrottle {

    static final int MAX_ATTEMPTS = 3;
    static final List<Duration> LOCKS = List.of(Duration.ofMinutes(15), Duration.ofHours(1), Duration.ofHours(24));
    static final Duration QUIET_RESET = Duration.ofHours(24);

    /** `lockedUntil` is the latest lock (possibly in the past); `updatedAt` the last attempt. */
    public record State(int failures, int stage, Instant lockedUntil, Instant updatedAt) {}

    /**
     * The outcome of one attempt: `locked` turns it away; otherwise it may go ahead with `attemptsLeft` more after it.
     * `lockedUntil` is set when it is turned away, or when this attempt is the last before a lock.
     */
    public record Decision(State next, boolean locked, int attemptsLeft, Instant lockedUntil) {}

    /** Pure: the decision for one login attempt at `now`, given the stored state (null if none). */
    static Decision attempt(State s, Instant now) {
        if (s != null && s.lockedUntil() != null && now.isBefore(s.lockedUntil())) {
            return new Decision(s, true, 0, s.lockedUntil());
        }
        if (s == null || !now.isBefore(quietSince(s).plus(QUIET_RESET))) {
            s = new State(0, 0, null, now);
        }
        int failures = s.failures() + 1;
        if (failures < MAX_ATTEMPTS) {
            return new Decision(new State(failures, s.stage(), s.lockedUntil(), now), false, MAX_ATTEMPTS - failures, null);
        }
        Instant until = now.plus(LOCKS.get(Math.min(s.stage(), LOCKS.size() - 1)));
        return new Decision(new State(0, s.stage() + 1, until, now), false, 0, until);
    }

    private static Instant quietSince(State s) {
        return s.lockedUntil() != null && s.lockedUntil().isAfter(s.updatedAt()) ? s.lockedUntil() : s.updatedAt();
    }

    private final JdbcTemplate jdbc;
    private final Clock clock = Clock.systemUTC();

    public LoginThrottle(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Records one login attempt; call inside the login transaction (the row is locked until it commits). */
    public Decision attempt(byte[] handleLookup) {
        Instant now = clock.instant();
        jdbc.update("INSERT IGNORE INTO login_throttle (handle_lookup, failures, stage, locked_until, updated_at) VALUES (?, 0, 0, NULL, ?)",
                handleLookup, Timestamp.from(now));
        State s = jdbc.queryForObject(
                "SELECT failures, stage, locked_until, updated_at FROM login_throttle WHERE handle_lookup = ? FOR UPDATE",
                (rs, i) -> new State(rs.getInt(1), rs.getInt(2),
                        rs.getTimestamp(3) == null ? null : rs.getTimestamp(3).toInstant(), rs.getTimestamp(4).toInstant()),
                (Object) handleLookup);
        Decision d = attempt(s, now);
        if (!d.locked()) {
            State n = d.next();
            jdbc.update("UPDATE login_throttle SET failures = ?, stage = ?, locked_until = ?, updated_at = ? WHERE handle_lookup = ?",
                    n.failures(), n.stage(), n.lockedUntil() == null ? null : Timestamp.from(n.lockedUntil()),
                    Timestamp.from(n.updatedAt()), handleLookup);
        }
        return d;
    }

    /** A successful login or password reset: start over. */
    public void clear(byte[] handleLookup) {
        jdbc.update("DELETE FROM login_throttle WHERE handle_lookup = ?", (Object) handleLookup);
    }

    /**
     * Throttle rows with no lock in force and no attempt for a week carry no information any more; sign-in events are
     * shown for 30 days.
     */
    @Scheduled(fixedDelay = 3_600_000, initialDelay = 300_000)
    void sweep() {
        Instant now = clock.instant();
        try {
            jdbc.update("DELETE FROM login_throttle WHERE updated_at < ? AND (locked_until IS NULL OR locked_until < ?)",
                    Timestamp.from(now.minus(Duration.ofDays(7))), Timestamp.from(now));
            jdbc.update("DELETE FROM security_events WHERE created_at < ?", Timestamp.from(now.minus(Duration.ofDays(30))));
        } catch (RuntimeException e) {
            // database briefly unavailable: next run
        }
    }
}
