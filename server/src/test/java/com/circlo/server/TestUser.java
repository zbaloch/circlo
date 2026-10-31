package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.ResponseEntity;

/** Plays the app for one account: signs up through the real email-code flow and calls the API with its session. */
final class TestUser {

    static final String PASSWORD = "correct horse battery staple";

    final IntegrationTest it;
    final String name;
    final String username;
    final String email;
    String password;
    UUID userId;
    UUID deviceId;
    String accessToken;
    String refreshToken;

    TestUser(IntegrationTest it, String name, String username, String email, String password) {
        this.it = it;
        this.name = name;
        this.username = username;
        this.email = email;
        this.password = password;
    }

    ResponseEntity<Map<String, Object>> startSignup() {
        return it.call("POST", "/v1/auth/signup", Map.of("name", name, "username", username, "email", email, "password", password), null);
    }

    TestUser signUp() {
        assertThat(startSignup().getStatusCode().value()).isEqualTo(201);
        ResponseEntity<Map<String, Object>> r = it.call("POST", "/v1/auth/signup/verify", Map.of("email", email, "code", it.mail.lastCode(email)), null);
        assertThat(r.getStatusCode().value()).isEqualTo(200);
        take(r.getBody());
        return this;
    }

    void take(Map<String, Object> tokens) {
        userId = UUID.fromString((String) tokens.get("userId"));
        deviceId = UUID.fromString((String) tokens.get("deviceId"));
        accessToken = (String) tokens.get("accessToken");
        refreshToken = (String) tokens.get("refreshToken");
    }

    ResponseEntity<Map<String, Object>> login(String login, String pw) {
        return it.call("POST", "/v1/auth/login", Map.of("login", login, "password", pw), null);
    }

    /** Signs in again as a second device; returns its tokens. */
    Map<String, Object> loginAgain() {
        ResponseEntity<Map<String, Object>> r = login(username, password);
        assertThat(r.getStatusCode().value()).isEqualTo(200);
        return r.getBody();
    }

    ResponseEntity<Map<String, Object>> call(String method, String path, Object body) {
        return it.call(method, path, body, accessToken);
    }

    ResponseEntity<List<Map<String, Object>>> list(String method, String path, Object body) {
        return it.list(method, path, body, accessToken);
    }

    int status(String method, String path, Object body) {
        return call(method, path, body).getStatusCode().value();
    }

    List<Map<String, Object>> get(String path) {
        ResponseEntity<List<Map<String, Object>>> r = list("GET", path, null);
        assertThat(r.getStatusCode().value()).as("GET " + path).isEqualTo(200);
        return r.getBody();
    }

    /** Makes us friends through an invite of mine, putting me in `theirCircles` of theirs and them in `myCircles`. */
    void befriend(TestUser other, List<Integer> myCircles, List<Integer> theirCircles) {
        String token = (String) call("POST", "/v1/invites", null).getBody().get("token");
        assertThat(other.status("POST", "/v1/invites/redeem", Map.of("token", token))).isEqualTo(200);
        assertThat(other.status("POST", "/v1/friends/requests", Map.of("toUserId", userId.toString(), "circles", theirCircles))).isEqualTo(201);
        assertThat(status("POST", "/v1/friends/" + other.userId + "/accept", Map.of("circles", myCircles))).isEqualTo(200);
    }

    void befriend(TestUser other) {
        befriend(other, List.of(), List.of());
    }

    /** Creates a text post; returns its id. */
    String post(String text, String kind, List<Integer> circles) {
        ResponseEntity<Map<String, Object>> r = call("POST", "/v1/posts", Map.of("text", text, "audience", Map.of("kind", kind, "circles", circles)));
        assertThat(r.getStatusCode().value()).as("create post").isEqualTo(201);
        return (String) r.getBody().get("postId");
    }

    /** Texts of the posts in my feed, newest first. */
    List<String> feedTexts() {
        return get("/v1/feed").stream().map(p -> (String) p.get("text")).toList();
    }
}
