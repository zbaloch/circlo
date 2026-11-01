package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/** Reports keep evidence; export returns my data; deleting an account leaves nothing behind. */
class SafetyFlowIT extends IntegrationTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void reportsKeepACopyOfWhatWasReported() {
        TestUser a = user("rep_author");
        TestUser b = user("rep_reporter");
        TestUser c = user("rep_outsider");
        a.befriend(b);
        String post = a.post("something awful", "everyone", List.of());
        assertThat(c.status("POST", "/v1/reports", Map.of("kind", "post", "targetId", post, "reason", "harassment"))).isEqualTo(404);
        assertThat(b.status("POST", "/v1/reports", Map.of("kind", "post", "targetId", post, "reason", "harassment", "note", "please look"))).isEqualTo(201);
        a.call("DELETE", "/v1/posts/" + post, null);
        assertThat(jdbc.queryForObject("SELECT snapshot FROM reports WHERE reason = 'harassment'", String.class)).contains("something awful");
        assertThat(b.status("POST", "/v1/reports", Map.of("kind", "user", "targetId", a.userId.toString(), "reason", "spam"))).isEqualTo(201);
    }

    @Test
    void exportHasMyPostsAndChats() {
        TestUser a = user("exp_ana");
        TestUser b = user("exp_ben");
        a.befriend(b);
        a.post("export me", "everyone", List.of());
        String chatId = (String) a.call("POST", "/v1/chats", Map.of("userIds", List.of(b.userId.toString()))).getBody().get("chatId");
        b.call("POST", "/v1/chats/" + chatId + "/messages", Map.of("text", "hello in export"));
        String json = http().get().uri("/v1/me/export").header("Authorization", "Bearer " + a.accessToken).retrieve().body(String.class);
        assertThat(json).contains("export me", "hello in export", "exp_ben", a.email).doesNotContain("argon2");
    }

    @Test
    void deletingTheAccountNeedsThePasswordAndRemovesEverything() {
        TestUser a = user("del_ana");
        TestUser b = user("del_ben");
        a.befriend(b);
        a.post("gone soon", "everyone", List.of());
        assertThat(a.call("DELETE", "/v1/account", Map.of("password", "not my password")).getBody()).containsEntry("error", "wrong_password");
        assertThat(a.status("DELETE", "/v1/account", Map.of("password", TestUser.PASSWORD))).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM users WHERE username = 'del_ana'", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM posts WHERE body = 'gone soon'", Integer.class)).isZero();
        assertThat(b.get("/v1/friends")).isEmpty();
        assertThat(a.login("del_ana", TestUser.PASSWORD).getStatusCode().value()).isEqualTo(401);
    }
}
