package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/** The schema must never grow plaintext-identity columns (PLAN.md section 3). */
class SchemaIT extends IntegrationTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void connectsToTheTestDatabaseOnly() {
        assertThat(jdbc.queryForObject("SELECT DATABASE()", String.class)).isEqualTo("circlo_test");
    }

    @Test
    void noIdentityOrTrackingColumns() {
        List<String> bad = jdbc.queryForList(
                "SELECT CONCAT(table_name, '.', column_name) FROM information_schema.columns "
                        + "WHERE table_schema = DATABASE() AND table_name <> 'flyway_schema_history' "
                        + "AND (column_name REGEXP '(^|_)(name|email|circle|caption|phone|password|ip|address)(_|$)' "
                        // No tracking: where, on what, or when someone was last around.
                        + "OR column_name REGEXP '(^|_)(location|lat|lng|latitude|longitude|geo|country|city|agent|ua|model|os|locale|timezone|tz|fingerprint)(_|$)' "
                        + "OR column_name REGEXP '^last_(seen|login|active|ip)' "
                        // handle_lookup is the keyed HMAC; a plaintext handle column must never exist.
                        + "OR column_name = 'handle')",
                String.class);
        assertThat(bad).isEmpty();
    }

    @Test
    void devPresignEndpointDoesNotExistOutsideTheLocalProfile() {
        assertThat(call("POST", "/dev/presign-put", null, null).getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void allPlanTablesExist() {
        List<String> tables = jdbc.queryForList(
                "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()", String.class);
        assertThat(tables).contains("users", "key_backups", "devices", "identity_keys", "friendships", "friend_payloads",
                "epochs", "user_blobs", "posts", "post_media", "post_replies", "post_likes", "mls_key_packages",
                "mls_groups", "mls_messages", "mls_welcomes", "invites");
    }
}
