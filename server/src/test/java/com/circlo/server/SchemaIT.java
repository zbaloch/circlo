package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/** The schema keeps only what people give Circlo, and nothing that tracks them (docs/PRIVACY.md). */
class SchemaIT extends IntegrationTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void connectsToTheTestDatabaseOnly() {
        assertThat(jdbc.queryForObject("SELECT DATABASE()", String.class)).isEqualTo("circlo_test");
    }

    @Test
    void noTrackingColumns() {
        List<String> bad = jdbc.queryForList(
                "SELECT CONCAT(table_name, '.', column_name) FROM information_schema.columns "
                        + "WHERE table_schema = DATABASE() AND table_name <> 'flyway_schema_history' "
                        + "AND (column_name REGEXP '(^|_)(phone|ip|address|location|lat|lng|latitude|longitude|geo|country|city|agent|ua|model|os|locale|timezone|tz|fingerprint)(_|$)' "
                        + "OR column_name REGEXP '^last_(seen|login|active|ip)')",
                String.class);
        assertThat(bad).isEmpty();
    }

    @Test
    void passwordsAreOnlyEverStoredAsHashes() {
        List<String> columns = jdbc.queryForList("SELECT CONCAT(table_name, '.', column_name) FROM information_schema.columns "
                + "WHERE table_schema = DATABASE() AND column_name LIKE '%password%'", String.class);
        assertThat(columns).containsExactly("users.password_hash");
    }

    @Test
    void theEncryptedDesignsTablesAreGone() {
        List<String> tables = jdbc.queryForList("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()", String.class);
        assertThat(tables).contains("users", "email_codes", "devices", "friendships", "circles", "circle_members", "posts",
                "chats", "chat_messages", "attachments", "reports");
        assertThat(tables).doesNotContain("key_backups", "identity_keys", "friend_payloads", "epochs", "mls_messages", "opaque_login_states",
                "recovery_methods", "user_blobs");
    }

    @Test
    void devPresignEndpointDoesNotExistOutsideTheLocalProfile() {
        assertThat(call("POST", "/dev/presign-put", null, null).getStatusCode().value()).isIn(401, 404);
    }
}
