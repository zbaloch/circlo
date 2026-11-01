package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** 1:1 and group chats between friends, read state, membership, blocking. */
class ChatFlowIT extends IntegrationTest {

    @Test
    void friendsChatAndReadStateFollowsTheMember() {
        TestUser a = user("chat_ana");
        TestUser b = user("chat_ben");
        TestUser stranger = user("chat_stranger");
        a.befriend(b);

        assertThat(a.call("POST", "/v1/chats", Map.of("userIds", List.of(stranger.userId.toString()))).getBody())
                .containsEntry("error", "not_a_friend");
        var chat = a.call("POST", "/v1/chats", Map.of("userIds", List.of(b.userId.toString())));
        assertThat(chat.getStatusCode().value()).isEqualTo(201);
        String chatId = (String) chat.getBody().get("chatId");
        // A second "new chat" with the same person opens the same one.
        assertThat(a.call("POST", "/v1/chats", Map.of("userIds", List.of(b.userId.toString()))).getBody()).containsEntry("chatId", chatId);

        var sent = a.call("POST", "/v1/chats/" + chatId + "/messages", Map.of("text", "hey ben"));
        assertThat(sent.getStatusCode().value()).isEqualTo(201);
        a.call("POST", "/v1/chats/" + chatId + "/messages", Map.of("text", "you there?"));

        Map<String, Object> inbox = b.get("/v1/chats").get(0);
        assertThat(inbox).containsEntry("chatId", chatId).containsEntry("unread", 2);
        assertThat(inbox.get("lastMessage")).asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP).containsEntry("text", "you there?");
        List<Map<String, Object>> messages = b.get("/v1/chats/" + chatId + "/messages");
        assertThat(messages).extracting(m -> m.get("text")).containsExactly("hey ben", "you there?");
        long last = ((Number) messages.get(1).get("seq")).longValue();
        assertThat(b.get("/v1/chats/" + chatId + "/messages?after=" + messages.get(0).get("seq"))).hasSize(1);

        b.call("POST", "/v1/chats/" + chatId + "/read", Map.of("seq", last));
        assertThat(b.get("/v1/chats").get(0)).containsEntry("unread", 0);
        assertThat(a.get("/v1/chats").get(0)).containsEntry("unread", 0); // my own messages aren't unread

        assertThat(stranger.status("GET", "/v1/chats/" + chatId + "/messages", null)).isEqualTo(404);
        assertThat(stranger.status("POST", "/v1/chats/" + chatId + "/messages", Map.of("text", "let me in"))).isEqualTo(404);

        // Only the sender can delete a message.
        String messageId = (String) sent.getBody().get("messageId");
        assertThat(b.status("DELETE", "/v1/chats/" + chatId + "/messages/" + messageId, null)).isEqualTo(404);
        assertThat(a.status("DELETE", "/v1/chats/" + chatId + "/messages/" + messageId, null)).isEqualTo(200);
        assertThat(b.get("/v1/chats/" + chatId + "/messages")).extracting(m -> m.get("text")).containsExactly("you there?");
    }

    @Test
    void groupsAddAndRemovePeople() {
        TestUser a = user("grp_ana");
        TestUser b = user("grp_ben");
        TestUser c = user("grp_cy");
        a.befriend(b);
        a.befriend(c);
        String chatId = (String) a.call("POST", "/v1/chats", Map.of("userIds", List.of(b.userId.toString()), "name", "Trip")).getBody().get("chatId");
        a.call("POST", "/v1/chats/" + chatId + "/messages", Map.of("text", "before cy"));
        assertThat(b.status("POST", "/v1/chats/" + chatId + "/members", Map.of("userIds", List.of(c.userId.toString())))).isEqualTo(400);
        assertThat(a.call("POST", "/v1/chats/" + chatId + "/members", Map.of("userIds", List.of(c.userId.toString()))).getBody())
                .containsEntry("name", "Trip");
        assertThat(c.get("/v1/chats").get(0)).containsEntry("unread", 0);
        a.call("POST", "/v1/chats/" + chatId + "/messages", Map.of("text", "welcome cy"));
        assertThat(c.get("/v1/chats").get(0)).containsEntry("unread", 1);

        assertThat(a.status("DELETE", "/v1/chats/" + chatId + "/members/" + c.userId, null)).isEqualTo(200);
        assertThat(c.get("/v1/chats")).isEmpty();
        assertThat(c.status("GET", "/v1/chats/" + chatId + "/messages", null)).isEqualTo(404);
        assertThat(b.status("DELETE", "/v1/chats/" + chatId + "/members/" + b.userId, null)).isEqualTo(200); // leave
        assertThat(a.get("/v1/chats").get(0).get("members")).asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.LIST).isEmpty();
    }

    @Test
    void messagesFromSomeoneIBlockedAreHidden() {
        TestUser a = user("blk_ana");
        TestUser b = user("blk_ben");
        a.befriend(b);
        String chatId = (String) a.call("POST", "/v1/chats", Map.of("userIds", List.of(b.userId.toString()))).getBody().get("chatId");
        b.call("POST", "/v1/chats/" + chatId + "/messages", Map.of("text", "spam"));
        a.call("POST", "/v1/blocks/" + b.userId, null);
        assertThat(a.get("/v1/chats/" + chatId + "/messages")).isEmpty();
        assertThat(a.get("/v1/chats").get(0)).containsEntry("unread", 0);
    }
}
