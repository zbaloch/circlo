package com.circlo.server.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

/** Three password attempts, then locks of 15 minutes, 1 hour and 24 hours; a quiet day starts over. */
class LoginThrottleTest {

    private static final Instant T0 = Instant.parse("2026-10-30T12:00:00Z");

    /** Makes three attempts at `now` and returns the state after them (the third sets the lock). */
    private static LoginThrottle.State threeAttempts(LoginThrottle.State s, Instant now) {
        for (int i = 0; i < 3; i++) {
            var d = LoginThrottle.attempt(s, now);
            assertThat(d.locked()).isFalse();
            s = d.next();
        }
        return s;
    }

    @Test
    void threeAttemptsThenLockedFor15Minutes() {
        var first = LoginThrottle.attempt(null, T0);
        assertThat(first.locked()).isFalse();
        assertThat(first.attemptsLeft()).isEqualTo(2);
        var second = LoginThrottle.attempt(first.next(), T0);
        assertThat(second.attemptsLeft()).isEqualTo(1);
        var third = LoginThrottle.attempt(second.next(), T0);
        assertThat(third.locked()).isFalse(); // the third attempt still runs; if it fails, the lock is already set
        assertThat(third.attemptsLeft()).isEqualTo(0);
        assertThat(third.lockedUntil()).isEqualTo(T0.plus(Duration.ofMinutes(15)));

        var fourth = LoginThrottle.attempt(third.next(), T0.plusSeconds(60));
        assertThat(fourth.locked()).isTrue();
        assertThat(fourth.lockedUntil()).isEqualTo(T0.plus(Duration.ofMinutes(15)));
        assertThat(fourth.next()).isEqualTo(third.next()); // being turned away doesn't extend the lock
    }

    @Test
    void locksEscalateTo1HourThen24Hours() {
        var s = threeAttempts(null, T0);
        assertThat(s.lockedUntil()).isEqualTo(T0.plus(Duration.ofMinutes(15)));

        Instant t1 = s.lockedUntil();
        s = threeAttempts(s, t1);
        assertThat(s.lockedUntil()).isEqualTo(t1.plus(Duration.ofHours(1)));

        Instant t2 = s.lockedUntil();
        s = threeAttempts(s, t2);
        assertThat(s.lockedUntil()).isEqualTo(t2.plus(Duration.ofHours(24)));

        // It stays at 24 hours: at most 3 guesses a day against any account.
        Instant t3 = s.lockedUntil();
        s = threeAttempts(s, t3);
        assertThat(s.lockedUntil()).isEqualTo(t3.plus(Duration.ofHours(24)));
    }

    @Test
    void aQuietDayStartsOver() {
        var s = threeAttempts(null, T0);
        s = threeAttempts(s, s.lockedUntil()); // now at the 1-hour stage
        Instant later = s.lockedUntil().plus(Duration.ofHours(24));
        assertThat(LoginThrottle.attempt(s, later).attemptsLeft()).isEqualTo(2);
        // Back at the first stage: the next lock is 15 minutes again.
        assertThat(threeAttempts(s, later).lockedUntil()).isEqualTo(later.plus(Duration.ofMinutes(15)));
    }

    @Test
    void oneFailureDoesNotLingerForever() {
        var d = LoginThrottle.attempt(null, T0);
        var later = LoginThrottle.attempt(d.next(), T0.plus(Duration.ofHours(25)));
        assertThat(later.attemptsLeft()).isEqualTo(2);
    }
}
