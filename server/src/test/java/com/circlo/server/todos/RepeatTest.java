package com.circlo.server.todos;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/** A repeating to-do's next date: one step on, past today if it was overdue, and months keep their day. */
class RepeatTest {

    private static LocalDate d(String s) {
        return LocalDate.parse(s);
    }

    @Test
    void stepsOnFromItsDate() {
        assertThat(Repeat.next(d("2026-11-27"), "daily", null, d("2026-11-27"))).isEqualTo(d("2026-11-28"));
        assertThat(Repeat.next(d("2026-11-23"), "weekly", null, d("2026-11-20"))).isEqualTo(d("2026-11-30"));
        assertThat(Repeat.next(d("2026-11-15"), "monthly", 15, d("2026-11-15"))).isEqualTo(d("2026-12-15"));
    }

    @Test
    void overdueOnesMovePastToday() {
        assertThat(Repeat.next(d("2026-11-01"), "daily", null, d("2026-11-27"))).isEqualTo(d("2026-11-28"));
        assertThat(Repeat.next(d("2026-10-05"), "weekly", null, d("2026-11-27"))).isEqualTo(d("2026-11-30"));
    }

    @Test
    void monthsKeepTheirDayWhereTheyHaveIt() {
        assertThat(Repeat.next(d("2027-01-31"), "monthly", 31, d("2027-01-31"))).isEqualTo(d("2027-02-28"));
        assertThat(Repeat.next(d("2027-02-28"), "monthly", 31, d("2027-02-28"))).isEqualTo(d("2027-03-31"));
        assertThat(Repeat.next(d("2028-01-30"), "monthly", 30, d("2028-01-30"))).isEqualTo(d("2028-02-29"));
    }
}
