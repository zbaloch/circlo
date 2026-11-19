package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Notification settings per kind, X-style (owner decision 2026-11-18): messages, replies, and friend requests and new
 * friends each push at once unless turned off, and the 6pm reminder can be turned off on its own. They're settings of
 * the account, so they apply to all my phones; turning a phone's notifications off altogether stays on the phone.
 * Security alerts ignore them. The reminder also comes on days people in my circles posted something I can see.
 */
class NotificationSettingsIT extends IntegrationTest {

    static final String POSTS_PUSH = "Your circles shared something today. Catch up when you’re ready.";

    private void phone(TestUser u, String pushToken) {
        String access = (String) u.loginAgain().get("accessToken");
        assertThat(call("PUT", "/v1/devices/current", Map.of("kind", "android"), access).getStatusCode().value()).isEqualTo(200);
        assertThat(call("PUT", "/v1/devices/current/push-token", Map.of("token", pushToken, "service", "fcm"), access)
                .getStatusCode().value()).isEqualTo(200);
    }

    private Map<String, Object> settings(TestUser u, Map<String, Object> change) {
        var res = u.call("PUT", "/v1/me/notifications", change);
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        return res.getBody();
    }

    private List<TestMail.Sent> dailyEmails(TestUser u) {
        return mail.to(u.email).stream().filter(s -> s.subject().equals("Your day on Circlo")).toList();
    }

    @Test
    void everyKindIsOnUntilTurnedOffAndOnlyMineAreReturned() {
        TestUser a = user("ns_defaults");
        assertThat(a.call("GET", "/v1/me", null).getBody()).containsEntry("pushMessages", true).containsEntry("pushReplies", true)
                .containsEntry("pushFriends", true).containsEntry("pushDaily", true);
        Map<String, Object> me = settings(a, Map.of("pushReplies", false, "pushDaily", false));
        assertThat(me).containsEntry("pushMessages", true).containsEntry("pushReplies", false).containsEntry("pushFriends", true)
                .containsEntry("pushDaily", false).containsEntry("emailNotifications", true);
        // Left out means unchanged.
        assertThat(settings(a, Map.of("email", false))).containsEntry("pushReplies", false).containsEntry("emailNotifications", false);
        // Nobody else's settings show up anywhere about me.
        TestUser b = user("ns_other");
        a.befriend(b);
        assertThat(b.call("GET", "/v1/users/" + a.userId, null).getBody()).doesNotContainKeys("pushMessages", "pushReplies", "pushDaily");
    }

    @Test
    void eachKindCanBeTurnedOffForAllMyPhones() throws Exception {
        TestUser a = user("ns_kinds");
        TestUser b = user("ns_kinds_friend");
        phone(a, "ns-tok-a1");
        phone(a, "ns-tok-a2");
        settings(a, Map.of("pushReplies", false, "pushFriends", false));

        // Friend requests and new friends off: Ben accepting Ana's request isn't pushed to her.
        b.befriend(a);
        // Replies off: no reply push on either phone. Messages still on: pushed to both.
        String post = a.post("dinner?", "everyone", List.of());
        b.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", "yes"));
        String chat = (String) b.call("POST", "/v1/chats", Map.of("userIds", List.of(a.userId.toString()))).getBody().get("chatId");
        b.call("POST", "/v1/chats/" + chat + "/messages", Map.of("text", "see you"));
        assertThat(push.await("ns-tok-a1", "message", 1)).hasSize(1);
        assertThat(push.await("ns-tok-a2", "message", 1)).hasSize(1);
        Thread.sleep(300);
        for (String t : List.of("ns-tok-a1", "ns-tok-a2")) {
            assertThat(push.to(t, "reply")).isEmpty();
            assertThat(push.to(t, "request")).isEmpty();
            assertThat(push.to(t, "friend")).isEmpty();
        }

        // Messages off too: nothing more.
        settings(a, Map.of("pushMessages", false));
        TestUser c = user("ns_kinds_third");
        a.befriend(c);
        String chat2 = (String) c.call("POST", "/v1/chats", Map.of("userIds", List.of(a.userId.toString()))).getBody().get("chatId");
        c.call("POST", "/v1/chats/" + chat2 + "/messages", Map.of("text", "hi"));
        Thread.sleep(300);
        assertThat(push.to("ns-tok-a1", "message")).hasSize(1);

        // The day still counts them: the reminder comes.
        sendDaily();
        assertThat(push.to("ns-tok-a1", "digest")).hasSize(1);
    }

    @Test
    void theDailyReminderCanBeTurnedOffOnItsOwn() throws Exception {
        TestUser a = user("ns_daily");
        TestUser b = user("ns_daily_friend");
        a.befriend(b);
        phone(a, "ns-tok-daily");
        String post = a.post("hello", "everyone", List.of());
        settings(a, Map.of("pushDaily", false));
        b.call("POST", "/v1/posts/" + post + "/replies", Map.of("text", "hi"));
        assertThat(push.await("ns-tok-daily", "reply", 1)).hasSize(1); // as it happens: still on
        int emails = dailyEmails(a).size();
        sendDaily();
        assertThat(push.to("ns-tok-daily", "digest")).isEmpty();
        assertThat(dailyEmails(a)).hasSize(emails + 1); // the email is its own setting
    }

    @Test
    void securityAlertsIgnoreTheSettings() throws Exception {
        TestUser a = user("ns_security");
        phone(a, "ns-tok-sec");
        settings(a, Map.of("pushMessages", false, "pushReplies", false, "pushFriends", false, "pushDaily", false));
        a.loginAgain();
        assertThat(push.await("ns-tok-sec", "security", 1)).hasSize(1);
    }

    @Test
    void theReminderComesOnDaysMyCirclesPosted() throws Exception {
        TestUser a = user("ns_posts");
        TestUser b = user("ns_posts_friend");
        TestUser outsider = user("ns_posts_outsider");
        a.befriend(b, List.of(1), List.of(1)); // in each other's circle 1
        b.befriend(outsider);
        phone(a, "ns-tok-posts");
        phone(outsider, "ns-tok-outsider");
        sendDaily(); // the friendships' day
        int emails = dailyEmails(a).size();
        int before = push.to("ns-tok-posts", "digest").size();

        // A post only to Ben's circle 1, which has Ana in it.
        b.post("the photos from saturday", "circles", List.of(1));
        Thread.sleep(300);
        assertThat(push.to("ns-tok-posts", "digest")).hasSize(before); // not as it happens: posts wait for the evening
        sendDaily();
        List<TestPush.Sent> reminder = push.to("ns-tok-posts", "digest");
        assertThat(reminder).hasSize(before + 1);
        assertThat(reminder.get(before).alert()).isEqualTo(POSTS_PUSH);
        assertThat(reminder.get(before).toString()).doesNotContain("saturday", "ns_posts_friend");
        List<TestMail.Sent> mails = dailyEmails(a);
        assertThat(mails).hasSize(emails + 1);
        assertThat(mails.get(mails.size() - 1).body()).contains("You have a new post from your circles waiting on Circlo.")
                .doesNotContain("saturday", "ns_posts_friend");
        // The outsider isn't in that circle: nothing for them.
        assertThat(push.to("ns-tok-outsider", "digest")).noneSatisfy(p -> assertThat(p.alert()).isEqualTo(POSTS_PUSH));

        // Posts only for Ben himself, and Ana's own posts, don't count for Ana.
        b.post("note to self", "onlyMe", List.of());
        a.post("my own news", "everyone", List.of());
        Thread.sleep(300);
        sendDaily();
        assertThat(push.to("ns-tok-posts", "digest")).hasSize(before + 1);

        // Posts and activity on the same day: the usual note.
        String mine = a.post("plans?", "everyone", List.of());
        b.post("weekend", "everyone", List.of());
        b.call("POST", "/v1/posts/" + mine + "/replies", Map.of("text", "beach"));
        Thread.sleep(300);
        sendDaily();
        List<TestPush.Sent> both = push.to("ns-tok-posts", "digest");
        assertThat(both).hasSize(before + 2);
        assertThat(both.get(before + 1).alert()).isEqualTo(NotifyChannelsIT.CALM_PUSH);
    }
}
