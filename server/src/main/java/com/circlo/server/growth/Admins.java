package com.circlo.server.growth;

import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Circlo's admins: the accounts whose email is listed in CIRCLO_ADMIN_EMAILS (comma-separated; none by default). They
 * can see the growth totals ({@link GrowthController}), which are counts only, never about one person.
 */
@Component
public class Admins {

    private final JdbcTemplate jdbc;
    private final Set<String> emails;

    public Admins(JdbcTemplate jdbc, @Value("${circlo.admin-emails:}") String emails) {
        this.jdbc = jdbc;
        this.emails = Arrays.stream(emails.split(",")).map(s -> s.trim().toLowerCase(Locale.ROOT)).filter(s -> !s.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
    }

    /** True if this (verified, account) email is an admin's. */
    public boolean email(String email) {
        return email != null && emails.contains(email.toLowerCase(Locale.ROOT));
    }

    /** True if this active account is an admin's. */
    public boolean user(byte[] userId) {
        if (emails.isEmpty()) {
            return false;
        }
        return jdbc.queryForList("SELECT email FROM users WHERE id = ? AND status = 'active'", String.class, (Object) userId)
                .stream().anyMatch(this::email);
    }
}
