package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Messages, replies, friend requests and new friends are pushed at once (owner decision 2026-11-18), content-free: a
 * fixed text and random ids so a tap opens the right screen. Never the sender's own phones, never from someone I
 * blocked, never to a phone with notifications off, and at most one per chat or post a minute. Security alerts and the
 * 6pm daily note are unchanged. `POST /v1/push/test` sends a test notification to all my phones and says, per phone,
 * whether it went.
 */
class PushIT extends IntegrationTest {

    /** Signs `u` in on a new phone of this kind with this push token; returns its access token. */
    private String phone(TestUser u, String kind, String pushToken) {
        String access = (String) u.loginAgain().get("accessToken");
        assertThat(call("PUT", "/v1/devices/current", Map.of("kind", kind), access).getStatusCode().value()).isEqualTo(200);
        String service = kind.equals("android") ? "fcm" : "apns";
        assertThat(call("PUT", "/v1/devices/current/push-token", Map.of("token", pushToken, "service", service), access)
                .getStatusCode().value()).isEqualTo(200);
        return access;
    }

    /** Pushes of this type to this token (signing in another phone also pushes a security alert; SecurityAlertsIT). */
    private List<TestPush.Sent> of(String token, String type) {
        return push.to(token).stream().filter(s -> type.equals(s.data().get("type"))).toList();
    }

    /** Waits up to 3 s for `n` pushes of this type to this token. */
    private List<TestPush.Sent> await(String token, String type, int n) throws InterruptedException {
        for (int i = 0; i < 60 && of(token, type).size() < n; i++) {
            Thread.sleep(50);
        }
        return of(token, type);
    }

    private String chat(TestUser from, TestUser to) {
        return (String) from.call("POST", "/v1/chats", Map.of("userIds", List.of(to.userId.toString()))).getBody().get("chatId");
    }

    @Test
    void aMessageIsPushedAtOnceToTheRecipientsPhonesOnly() throws Exception {
        TestUser a = user("push_ana");
        TestUser b = user("push_ben");
        a.befriend(b);
        phone(a, "ios", "push-tok-ana");
        phone(b, "android", "push-tok-ben-1");
        phone(b, "ios", "push-tok-ben-2");
        String chatId = chat(a, b);

        assertThat(a.status("POST", "/v1/chats/" + chatId + "/messages", Map.of("text", "hello ben"))).isEqualTo(201);
        List<TestPush.Sent> android = await("push-tok-ben-1", "message", 1);
        assertThat(android).hasSize(1);
        assertThat(android.get(0).service()).isEqualTo("fcm");
        assertThat(android.get(0).alert()).isEqualTo("New message");
        assertThat(android.get(0).data()).isEqualTo(Map.of("type", "message", "chatId", chatId));
        assertThat(await("push-tok-ben-2", "message", 1)).hasSize(1);
        // No words, names or counts leave the server.
        assertThat(android.get(0).toString()).doesNotContain("hello", "push_ana", "Ana");
        Thread.sleep(300);
        assertThat(of("push-tok-ana", "message")).isEmpty(); // the sender isn't told about their own message

        // A burst is one push per chat per minute.
        a.status("POST", "/v1/chats/" + chatId + "/messages", Map.of("text", "you there?"));
        Thread.sleep(300);
        assertThat(of("push-tok-ben-1", "message")).hasSize(1);

        // Ben answering pushes Ana.
        assertThat(b.status("POST", "/v1/chats/" + chatId + "/messages", Map.of("text", "yes"))).isEqualTo(201);
        assertThat(await("push-tok-ana", "message", 1)).hasSize(1);
    }

    @Test
    void repliesRequestsAndNewFriendsArePushedAtOnce() throws Exception {
        TestUser a = user("push_fay");
        TestUser b = user("push_gus");
        phone(a, "ios", "push-tok-fay");
        phone(b, "android", "push-tok-gus");

        // Gus asks Fay to connect; Fay accepts.
        a.befriend(b);
        List<TestPush.Sent> request = await("push-tok-fay", "request", 1);
        assertThat(request).hasSize(1);
        assertThat(request.get(0).alert()).isEqualTo("New friend request");
        assertThat(request.get(0).data()).isEqualTo(Map.of("type", "request"));
        List<TestPush.Sent> accepted = await("push-tok-gus", "friend", 1);
        assertThat(accepted).hasSize(1);
        assertThat(accepted.get(0).alert()).isEqualTo("Your friend request was accepted");
        assertThat(accepted.get(0).data()).isEqualTo(Map.of("type", "friend"));

        // Gus replies to Fay's post: Fay's phone opens that reply.
        String post = a.post("picnic on sunday", "everyone", List.of());
        String reply = (String) b.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", "count me in")).getBody().get("replyId");
        List<TestPush.Sent> replies = await("push-tok-fay", "reply", 1);
        assertThat(replies).hasSize(1);
        assertThat(replies.get(0).alert()).isEqualTo("New reply");
        assertThat(replies.get(0).data()).isEqualTo(Map.of("type", "reply", "postId", post, "replyId", reply));
        assertThat(replies.get(0).toString()).doesNotContain("picnic", "count me in", "push_gus");

        // More replies on the same post within a minute: still one push. Fay's own reply never pushes her.
        b.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", "and my sister"));
        a.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", "great"));
        Thread.sleep(300);
        assertThat(of("push-tok-fay", "reply")).hasSize(1);
        assertThat(of("push-tok-gus", "reply")).isEmpty();
    }

    @Test
    void noPushFromSomeoneIBlockedOrWithNotificationsOff() throws Exception {
        TestUser a = user("push_cat");
        TestUser b = user("push_dan");
        TestUser c = user("push_eve");
        a.befriend(b);
        a.befriend(c);
        String danPhone = phone(b, "android", "push-tok-dan");
        phone(c, "android", "push-tok-eve");

        // Dan turns notifications off on his phone: the app forgets its token.
        assertThat(call("DELETE", "/v1/devices/current/push-token", null, danPhone).getStatusCode().value()).isEqualTo(200);
        a.status("POST", "/v1/chats/" + chat(a, b) + "/messages", Map.of("text", "hi dan"));

        // Eve blocked Cat after they'd started a chat.
        String eveChat = chat(a, c);
        assertThat(c.status("POST", "/v1/blocks/" + a.userId, null)).isBetween(200, 204);
        a.call("POST", "/v1/chats/" + eveChat + "/messages", Map.of("text", "hi eve")); // refused or hidden: either way, no push

        Thread.sleep(400);
        assertThat(of("push-tok-dan", "message")).isEmpty();
        assertThat(of("push-tok-eve", "message")).isEmpty();
    }

    @Test
    @SuppressWarnings("unchecked")
    void testPushGoesToAllMyPhonesAndSaysWhatHappened() throws Exception {
        TestUser a = user("push_test");
        String off = phone(a, "android", "push-tok-test-3");
        assertThat(call("DELETE", "/v1/devices/current/push-token", null, off).getStatusCode().value()).isEqualTo(200);
        phone(a, "android", "push-tok-test-1");
        // Apple says this app is gone from that phone. Signed in last, so no sign-in alert has tried it yet.
        phone(a, "ios", "bad-push-tok-test-2");

        // Called from curl, i.e. a sign-in that isn't a phone: it still reaches the phones.
        var res = a.call("POST", "/v1/push/test", null);
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        Map<String, Object> body = res.getBody();
        assertThat(body).containsEntry("apns", "on").containsEntry("fcm", "on");
        List<Map<String, Object>> phones = (List<Map<String, Object>>) body.get("phones");
        assertThat(phones).extracting(p -> p.get("kind") + ":" + p.get("result"))
                .containsExactlyInAnyOrder("android:sent", "ios:unregistered", "android:notifications_off");
        assertThat(phones).allSatisfy(p -> assertThat(p).containsOnlyKeys("deviceId", "kind", "result"));

        List<TestPush.Sent> sent = await("push-tok-test-1", "test", 1);
        assertThat(sent).hasSize(1);
        assertThat(sent.get(0).alert()).isEqualTo("This is a test notification from Circlo.");
        assertThat(sent.get(0).data()).isEqualTo(Map.of("type", "test"));

        // The phone Apple called gone stops counting until it registers again.
        List<Map<String, Object>> again = (List<Map<String, Object>>) a.call("POST", "/v1/push/test", null).getBody().get("phones");
        assertThat(again).extracting(p -> p.get("kind") + ":" + p.get("result"))
                .containsExactlyInAnyOrder("android:sent", "ios:notifications_off", "android:notifications_off");
    }

    @Test
    void testPushNeedsASignInAndIsRateLimited() {
        assertThat(call("POST", "/v1/push/test", null, null).getStatusCode().value()).isEqualTo(401);
        TestUser a = user("push_limit");
        int ok = 0;
        int limited = 0;
        for (int i = 0; i < 12; i++) {
            int s = a.status("POST", "/v1/push/test", null);
            if (s == 200) {
                ok++;
            } else if (s == 429) {
                limited++;
            }
        }
        assertThat(ok).isEqualTo(10);
        assertThat(limited).isEqualTo(2);
    }
}
