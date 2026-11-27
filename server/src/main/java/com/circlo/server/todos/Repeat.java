package com.circlo.server.todos;

import java.time.LocalDate;
import java.util.Set;

/** A to-do's repeat: daily, weekly or monthly, counted from its date. */
public final class Repeat {

    public static final Set<String> RULES = Set.of("daily", "weekly", "monthly");

    private Repeat() {}

    /**
     * The next date after ticking a repeating to-do: one step on from its date, and on past {@code today} if it was
     * overdue (a walk ticked three days late is due tomorrow, not yesterday). A monthly one keeps its {@code day} of
     * the month where the month has it, so the 31st stays the 31st (Aug 31, Sep 30, Oct 31...).
     */
    public static LocalDate next(LocalDate due, String rule, Integer day, LocalDate today) {
        for (long n = 1; ; n++) {
            LocalDate d = switch (rule) {
                case "daily" -> due.plusDays(n);
                case "weekly" -> due.plusWeeks(n);
                case "monthly" -> {
                    LocalDate month = due.plusMonths(n);
                    int want = day == null ? due.getDayOfMonth() : day;
                    yield month.withDayOfMonth(Math.min(want, month.lengthOfMonth()));
                }
                default -> throw new IllegalArgumentException(rule);
            };
            if (d.isAfter(today)) {
                return d;
            }
        }
    }
}
