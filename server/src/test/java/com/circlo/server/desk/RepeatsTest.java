package com.circlo.server.desk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/** When a repeating to-do comes back after it's ticked off. */
class RepeatsTest {

    private static LocalDate d(String s) {
        return LocalDate.parse(s);
    }

    @Test
    void dailyComesBackTheDayAfterTodayOrItsDueDate() {
        // Done on the day: tomorrow.
        assertThat(Repeats.next("daily", 1, d("2026-11-14"), d("2026-11-14"), d("2026-11-14"))).isEqualTo(d("2026-11-15"));
        // Done late: still tomorrow, not a pile of missed days.
        assertThat(Repeats.next("daily", 1, d("2026-11-01"), d("2026-11-10"), d("2026-11-14"))).isEqualTo(d("2026-11-15"));
        // Done early: the day after it was due.
        assertThat(Repeats.next("daily", 1, d("2026-11-16"), d("2026-11-16"), d("2026-11-14"))).isEqualTo(d("2026-11-17"));
        // Every 3 days keeps its rhythm from the first due date.
        assertThat(Repeats.next("daily", 3, d("2026-11-01"), d("2026-11-13"), d("2026-11-14"))).isEqualTo(d("2026-11-16"));
    }

    @Test
    void weekdaysSkipTheWeekend() {
        // Friday 2026-11-13 → Monday.
        assertThat(Repeats.next("weekdays", 1, d("2026-11-13"), d("2026-11-13"), d("2026-11-13"))).isEqualTo(d("2026-11-16"));
        assertThat(Repeats.next("weekdays", 1, d("2026-11-10"), d("2026-11-10"), d("2026-11-10"))).isEqualTo(d("2026-11-11"));
    }

    @Test
    void weeklyStaysOnItsWeekday() {
        // Due Monday 2026-11-09, done Wednesday → next Monday.
        assertThat(Repeats.next("weekly", 1, d("2026-11-09"), d("2026-11-09"), d("2026-11-11"))).isEqualTo(d("2026-11-16"));
        // Every 2 weeks.
        assertThat(Repeats.next("weekly", 2, d("2026-11-09"), d("2026-11-09"), d("2026-11-09"))).isEqualTo(d("2026-11-23"));
    }

    @Test
    void monthlyKeepsItsDayWithoutDrifting() {
        assertThat(Repeats.next("monthly", 1, d("2026-11-05"), d("2026-11-05"), d("2026-11-05"))).isEqualTo(d("2026-12-05"));
        // The 31st falls back to the month's last day, then returns to the 31st.
        assertThat(Repeats.next("monthly", 1, d("2027-01-31"), d("2027-01-31"), d("2027-01-31"))).isEqualTo(d("2027-02-28"));
        assertThat(Repeats.next("monthly", 1, d("2027-01-31"), d("2027-02-28"), d("2027-02-28"))).isEqualTo(d("2027-03-31"));
        // Every 3 months.
        assertThat(Repeats.next("monthly", 3, d("2026-01-15"), d("2026-10-15"), d("2026-11-14"))).isEqualTo(d("2027-01-15"));
    }

    @Test
    void yearly() {
        assertThat(Repeats.next("yearly", 1, d("2024-02-29"), d("2026-02-28"), d("2026-03-01"))).isEqualTo(d("2027-02-28"));
        assertThat(Repeats.next("yearly", 1, d("2024-02-29"), d("2027-02-28"), d("2027-03-01"))).isEqualTo(d("2028-02-29"));
    }

    @Test
    void afterCountsFromTheDayItWasDone() {
        // Water the plants 7 days after they were last watered, whenever that was.
        assertThat(Repeats.next("after", 7, d("2026-11-01"), d("2026-11-01"), d("2026-11-14"))).isEqualTo(d("2026-11-21"));
        assertThat(Repeats.next("after", 7, null, null, d("2026-11-14"))).isEqualTo(d("2026-11-21"));
    }

    @Test
    void scheduledRepeatsWithoutADueDateStartFromToday() {
        assertThat(Repeats.next("weekly", 1, null, null, d("2026-11-14"))).isEqualTo(d("2026-11-21"));
    }

    @Test
    void unknownKindsAreRejected() {
        assertThatThrownBy(() -> Repeats.next("hourly", 1, null, null, d("2026-11-14"))).isInstanceOf(IllegalArgumentException.class);
    }
}
