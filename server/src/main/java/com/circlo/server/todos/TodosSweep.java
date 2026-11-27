package com.circlo.server.todos;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Lets go of to-dos completed more than 30 days ago, once an hour. */
@Component
public class TodosSweep {

    static final Duration KEEP_COMPLETED = Duration.ofDays(30);

    private final JdbcTemplate jdbc;

    public TodosSweep(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Scheduled(fixedDelay = 3_600_000, initialDelay = 600_000)
    void scheduled() {
        try {
            sweep(Instant.now());
        } catch (RuntimeException e) {
            // next run
        }
    }

    public void sweep(Instant now) {
        jdbc.update("DELETE FROM todos WHERE completed_at < ?", Timestamp.from(now.minus(KEEP_COMPLETED)));
    }
}
