package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

/** Likes on replies, a person's replies, reporting replies, content-free pushes, and live update signals. */
class EngagementFlowIT extends IntegrationTest {

    @org.springframework.beans.factory.annotation.Autowired
    private org.springframework.jdbc.core.JdbcTemplate jdbc;

    private int status(String method, String path) {
        return call(method, path, null, null).getStatusCode().value();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> items(Map<String, Object> activity) {
        return (List<Map<String, Object>>) activity.get("items");
    }

    @Test
    void repliesCanBeLikedByWhoeverSeesThePost() {
        TestUser a = user("rl_author");
        TestUser b = user("rl_friend");
        TestUser c = user("rl_outsider");
        a.befriend(b, List.of(1), List.of());
        a.befriend(c);
        String post = a.post("close friends", "circles", List.of(1));
        String other = a.post("for everyone", "everyone", List.of());
        String reply = (String) b.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", "hi")).getBody().get("replyId");

        assertThat(a.status("PUT", "/v1/posts/" + post + "/replies/" + reply + "/like", null)).isEqualTo(200);
        assertThat(a.status("PUT", "/v1/posts/" + post + "/replies/" + reply + "/like", null)).isEqualTo(200); // idempotent
        assertThat(a.get("/v1/posts/" + post + "/replies").get(0)).containsEntry("likeCount", 1).containsEntry("likedByMe", true);
        assertThat(b.get("/v1/posts/" + post + "/replies").get(0)).containsEntry("likeCount", 1).containsEntry("likedByMe", false);

        // Outside the audience, or through another post, the reply doesn't exist.
        assertThat(c.status("PUT", "/v1/posts/" + post + "/replies/" + reply + "/like", null)).isEqualTo(404);
        assertThat(c.status("PUT", "/v1/posts/" + other + "/replies/" + reply + "/like", null)).isEqualTo(404);

        // The reply's author hears about it.
        List<Map<String, Object>> activity = items(b.call("GET", "/v1/activity", null).getBody());
        assertThat(activity).extracting(i -> i.get("kind")).containsExactly("reply_like");
        assertThat(activity.get(0)).containsEntry("replyId", reply).containsEntry("replyText", "hi").containsEntry("postId", post);

        assertThat(a.status("DELETE", "/v1/posts/" + post + "/replies/" + reply + "/like", null)).isEqualTo(200);
        assertThat(a.get("/v1/posts/" + post + "/replies").get(0)).containsEntry("likeCount", 0).containsEntry("likedByMe", false);
        assertThat(items(b.call("GET", "/v1/activity", null).getBody())).isEmpty();
    }

    @Test
    void aPersonsRepliesShowOnlyOnPostsICanSee() {
        TestUser a = user("ur_author");
        TestUser b = user("ur_replier");
        TestUser c = user("ur_reader");
        TestUser d = user("ur_stranger");
        a.befriend(b, List.of(1), List.of());
        a.befriend(c);
        b.befriend(c);
        String secret = a.post("close friends", "circles", List.of(1));
        String open = a.post("everyone", "everyone", List.of());
        b.call("POST", "/v1/posts/" + secret + "/replies", Map.of("text", "on the secret one"));
        b.call("POST", "/v1/posts/" + open + "/replies", Map.of("text", "on the open one"));

        List<Map<String, Object>> seen = c.get("/v1/users/" + b.userId + "/replies");
        assertThat(seen).extracting(r -> (Object) ((Map<?, ?>) r.get("reply")).get("text")).containsExactly("on the open one");
        assertThat(seen.get(0).get("post")).asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP)
                .containsEntry("postId", open).containsEntry("text", "everyone").containsEntry("audience", null);
        assertThat(b.get("/v1/users/" + b.userId + "/replies")).hasSize(2);
        assertThat(d.get("/v1/users/" + b.userId + "/replies")).isEmpty();
    }

    @Test
    void repliesCanBeReported() {
        TestUser a = user("rr_author");
        TestUser b = user("rr_friend");
        TestUser c = user("rr_stranger");
        a.befriend(b);
        String post = a.post("hello", "everyone", List.of());
        String reply = (String) b.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", "rude")).getBody().get("replyId");
        assertThat(a.status("POST", "/v1/reports", Map.of("kind", "reply", "targetId", reply, "reason", "harassment"))).isEqualTo(201);
        assertThat(c.status("POST", "/v1/reports", Map.of("kind", "reply", "targetId", reply, "reason", "harassment"))).isEqualTo(404);
    }

    @Test
    void theDailyPushIsCalmAndOnlyReachesTheRecipient() {
        TestUser a = user("push_author");
        TestUser b = user("push_friend");
        a.befriend(b);
        sendDaily(); // the friend request's day
        assertThat(a.status("PUT", "/v1/devices/current/push-token", Map.of("token", "tok-a", "service", "apns"))).isEqualTo(200);
        assertThat(b.status("PUT", "/v1/devices/current/push-token", Map.of("token", "tok-b", "service", "apns_sandbox"))).isEqualTo(200);
        assertThat(a.status("PUT", "/v1/devices/current/push-token", Map.of("token", "x", "service", "carrier-pigeon"))).isEqualTo(400);
        // An Android phone of A's: the same push, through FCM.
        Map<String, Object> phone = a.loginAgain();
        assertThat(call("PUT", "/v1/devices/current/push-token", Map.of("token", "fcm-tok-a", "service", "fcm"), (String) phone.get("accessToken"))
                .getStatusCode().value()).isEqualTo(200);

        String post = a.post("tell me", "everyone", List.of());
        b.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", "secret words"));
        // Likes update the app live but are never told.
        b.call("PUT", "/v1/posts/" + post + "/like", null);
        sendDaily();
        List<TestPush.Sent> toA = push.to("tok-a");
        assertThat(toA).hasSize(1);
        assertThat(toA.get(0).alert()).isEqualTo(NotifyChannelsIT.CALM_PUSH);
        assertThat(toA.get(0).service()).isEqualTo("apns");
        assertThat(toA.get(0).data()).isEqualTo(Map.of("type", "digest"));
        List<TestPush.Sent> toAndroid = push.to("fcm-tok-a");
        assertThat(toAndroid).hasSize(1);
        assertThat(toAndroid.get(0).service()).isEqualTo("fcm");
        assertThat(toAndroid.get(0).data()).isEqualTo(toA.get(0).data());
        assertThat(push.to("tok-b")).isEmpty(); // never my own activity

        String chat = (String) a.call("POST", "/v1/chats", Map.of("userIds", List.of(b.userId.toString()))).getBody().get("chatId");
        a.call("POST", "/v1/chats/" + chat + "/messages", Map.of("text", "meet at 7"));
        sendDaily();
        List<TestPush.Sent> toB = push.to("tok-b");
        assertThat(toB).hasSize(1);
        assertThat(toB.get(0).service()).isEqualTo("apns_sandbox");
        assertThat(push.to("tok-a")).hasSize(1); // a quiet day for A

        // Nothing a push says names anyone or quotes anything.
        for (TestPush.Sent s : List.of(toA.get(0), toB.get(0))) {
            assertThat(s.toString()).doesNotContain("secret words", "meet at 7", "push_author", "push_friend");
        }

        // Someone I blocked can't make my phone buzz; signing out forgets the device's token.
        b.call("POST", "/v1/blocks/" + a.userId, null);
        a.call("POST", "/v1/chats/" + chat + "/messages", Map.of("text", "hello?"));
        sendDaily();
        assertThat(push.to("tok-b")).hasSize(1);
        assertThat(a.status("POST", "/v1/auth/logout", null)).isEqualTo(200);
        // Only the device that signed out; A's Android phone is still signed in and keeps its token.
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM devices WHERE push_token_enc IS NOT NULL AND id = ?", Integer.class,
                (Object) com.circlo.server.web.Ids.bytes(a.deviceId))).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM devices WHERE push_token_enc IS NOT NULL AND user_id = ?", Integer.class,
                (Object) com.circlo.server.web.Ids.bytes(a.userId))).isEqualTo(1);
    }

    @Test
    void friendRequestsAreToldAndUnregisteredTokensAreForgotten() {
        TestUser a = user("pushreq_a");
        TestUser b = user("pushreq_b");
        a.call("PUT", "/v1/devices/current/push-token", Map.of("token", "bad-token", "service", "apns"));
        String token = (String) a.call("POST", "/v1/invites", null).getBody().get("token");
        b.call("POST", "/v1/invites/redeem", Map.of("token", token));
        b.call("POST", "/v1/friends/requests", Map.of("toUserId", a.userId.toString(), "circles", List.of()));
        sendDaily();
        List<TestPush.Sent> sent = push.to("bad-token");
        assertThat(sent).hasSize(1);
        assertThat(sent.get(0).data()).isEqualTo(Map.of("type", "digest"));

        // Apple said the token is gone: it isn't used again.
        b.call("DELETE", "/v1/friends/" + a.userId, null);
        b.call("POST", "/v1/friends/requests", Map.of("toUserId", a.userId.toString(), "circles", List.of()));
        sendDaily();
        assertThat(push.to("bad-token")).hasSize(1);
    }

    @Test
    void liveSignalsWakeAWaitingApp() throws Exception {
        TestUser a = user("live_a");
        TestUser b = user("live_b");
        a.befriend(b);
        String post = a.post("hi", "everyone", List.of());

        // An unknown or old version answers at once with the current one.
        long v = ((Number) a.call("GET", "/v1/events?since=0", null).getBody().get("version")).longValue();
        assertThat(v).isPositive();

        // Waiting on the current version returns as soon as something happens for me.
        CompletableFuture<Map<String, Object>> waiting = CompletableFuture.supplyAsync(() -> a.call("GET", "/v1/events?since=" + v, null).getBody());
        Thread.sleep(300);
        assertThat(waiting).isNotDone();
        b.call("PUT", "/v1/posts/" + post + "/like", null);
        long next = ((Number) waiting.get(5, TimeUnit.SECONDS).get("version")).longValue();
        assertThat(next).isGreaterThan(v);
        assertThat(a.status("GET", "/v1/events?since=" + v, null)).isEqualTo(200); // already newer: answers at once
        assertThat(status("GET", "/v1/events?since=0")).isEqualTo(401);
    }
}
