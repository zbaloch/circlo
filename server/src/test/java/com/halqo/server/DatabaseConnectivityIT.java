package com.halqo.server;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest
@ActiveProfiles("test")
class DatabaseConnectivityIT {

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void connectsToTheTestDatabaseOnly() {
        assertThat(jdbc.queryForObject("SELECT DATABASE()", String.class)).isEqualTo("halqo_test");
    }
}
