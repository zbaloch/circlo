package com.circlo.server.desk;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.Set;

/** When a repeating to-do comes back after it's done. Pure date arithmetic on the owner's calendar days. */
public final class Repeats {

    public static final Set<String> KINDS = Set.of("daily", "weekdays", "weekly", "monthly", "yearly", "after");

    private Repeats() {}

    /**
     * The next due date. "after" is `every` days after `today` (the day it was done). The others are the first date on
     * their schedule (counted from `anchor`, the series' first due date) after both its due date and today: done late,
     * it comes back once, not once per missed day; done early, it comes back after the date it was due.
     */
    public static LocalDate next(String kind, int every, LocalDate anchor, LocalDate due, LocalDate today) {
        if (!KINDS.contains(kind)) {
            throw new IllegalArgumentException("repeat kind");
        }
        if (kind.equals("after")) {
            return today.plusDays(every);
        }
        LocalDate floor = due != null && due.isAfter(today) ? due : today;
        LocalDate start = anchor != null ? anchor : due != null ? due : today;
        if (kind.equals("weekdays")) {
            LocalDate d = floor.plusDays(1);
            while (d.getDayOfWeek() == DayOfWeek.SATURDAY || d.getDayOfWeek() == DayOfWeek.SUNDAY) {
                d = d.plusDays(1);
            }
            return d;
        }
        ChronoUnit unit = switch (kind) {
            case "daily" -> ChronoUnit.DAYS;
            case "weekly" -> ChronoUnit.WEEKS;
            case "monthly" -> ChronoUnit.MONTHS;
            default -> ChronoUnit.YEARS;
        };
        // Jump close to the floor, then step: k * every units from the anchor, so month ends don't drift.
        long k = Math.max(1, unit.between(start, floor) / every);
        LocalDate d = start.plus(k * every, unit);
        while (!d.isAfter(floor)) {
            k++;
            d = start.plus(k * every, unit);
        }
        return d;
    }
}
