package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.assertj.core.api.InstanceOfAssertFactories;
import org.junit.jupiter.api.Test;

/** Replying to one message in a chat: the reply carries a short quote of it, only from the same chat, and only while it's there. */
class ChatReplyIT extends IntegrationTest {

    private static String chat(TestUser a, TestUser... others) {
        List<String> ids = java.util.Arrays.stream(others).map(u -> u.userId.toString()).toList();
        return (String) a.call("POST", "/v1/chats", Map.of("userIds", ids, "name", "Plans")).getBody().get("chatId");
    }

    private static Map<String, Object> send(TestUser u, String chatId, String text, String replyTo) {
        Map<String, Object> body = new HashMap<>(Map.of("text", text));
        if (replyTo != null) {
            body.put("replyTo", replyTo);
        }
        return u.call("POST", "/v1/chats/" + chatId + "/messages", body).getBody();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> quoteOf(Map<String, Object> message) {
        return (Map<String, Object>) message.get("replyTo");
    }

    @Test
    void aReplyQuotesTheMessageForEveryoneInTheChat() {
        TestUser a = user("rq_ana");
        TestUser b = user("rq_ben");
        a.befriend(b);
        String chatId = chat(a, b);
        String dinner = (String) send(a, chatId, "Dinner at 8?", null).get("messageId");
        send(a, chatId, "Or 9", null);

        Map<String, Object> reply = send(b, chatId, "8 works", dinner);
        assertThat(quoteOf(reply)).containsEntry("messageId", dinner).containsEntry("senderId", a.userId.toString())
                .containsEntry("text", "Dinner at 8?").containsEntry("available", true).containsEntry("mediaType", null);

        // Everyone sees the same quote, in the messages and as the chat's last message.
        List<Map<String, Object>> seen = a.get("/v1/chats/" + chatId + "/messages");
        assertThat(seen).extracting(m -> m.get("text")).containsExactly("Dinner at 8?", "Or 9", "8 works");
        assertThat(seen.get(0).get("replyTo")).isNull();
        assertThat(quoteOf(seen.get(2))).containsEntry("text", "Dinner at 8?");
        assertThat(quoteOf((Map<String, Object>) a.get("/v1/chats").get(0).get("lastMessage"))).containsEntry("messageId", dinner);
    }

    @Test
    void onlyAMessageInTheSameChatCanBeRepliedTo() {
        TestUser a = user("rv_ana");
        TestUser b = user("rv_ben");
        TestUser c = user("rv_cy");
        a.befriend(b);
        a.befriend(c);
        String ours = chat(a, b);
        String other = chat(a, c);
        String elsewhere = (String) send(c, other, "secret", null).get("messageId");

        assertThat(send(b, ours, "what?", elsewhere)).containsEntry("error", "invalid_reply");
        assertThat(send(b, ours, "what?", UUID.randomUUID().toString())).containsEntry("error", "invalid_reply");
        assertThat(b.get("/v1/chats/" + ours + "/messages")).isEmpty();
    }

    @Test
    void aLongMessageIsQuotedShort() {
        TestUser a = user("rl_ana");
        TestUser b = user("rl_ben");
        a.befriend(b);
        String chatId = chat(a, b);
        String essay = "word ".repeat(100).strip();
        String id = (String) send(a, chatId, essay, null).get("messageId");
        String quoted = (String) quoteOf(send(b, chatId, "tl;dr", id)).get("text");
        assertThat(quoted).hasSizeLessThanOrEqualTo(141).endsWith("…").startsWith("word word");
    }

    @Test
    void aDeletedOrBlockedMessageIsNoLongerQuoted() {
        TestUser a = user("rd_ana");
        TestUser b = user("rd_ben");
        TestUser c = user("rd_cy");
        a.befriend(b);
        a.befriend(c);
        String chatId = chat(a, b, c);
        String gone = (String) send(a, chatId, "oops, wrong chat", null).get("messageId");
        send(b, chatId, "what was that?", gone);
        a.call("DELETE", "/v1/chats/" + chatId + "/messages/" + gone, null);
        Map<String, Object> deleted = quoteOf(b.get("/v1/chats/" + chatId + "/messages").get(0));
        assertThat(deleted).containsEntry("messageId", gone).containsEntry("available", false).containsEntry("text", null)
                .containsEntry("senderId", null);

        // Someone I blocked: their message is hidden for me, and so is its quote in others' replies.
        String fromCy = (String) send(c, chatId, "my new number is …", null).get("messageId");
        send(b, chatId, "saved it", fromCy);
        a.call("POST", "/v1/blocks/" + c.userId, null);
        List<Map<String, Object>> forAna = a.get("/v1/chats/" + chatId + "/messages");
        assertThat(quoteOf(forAna.get(forAna.size() - 1))).containsEntry("available", false).containsEntry("text", null);
        List<Map<String, Object>> forBen = b.get("/v1/chats/" + chatId + "/messages");
        assertThat(quoteOf(forBen.get(forBen.size() - 1))).containsEntry("available", true).containsEntry("text", "my new number is …");
        assertThat(forBen.get(forBen.size() - 1)).extracting("replyTo").asInstanceOf(InstanceOfAssertFactories.MAP)
                .containsEntry("senderId", c.userId.toString());
    }
}
