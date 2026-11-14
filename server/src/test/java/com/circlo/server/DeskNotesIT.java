package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Desk notes (owner decision 2026-11-14): a title, a body and follow-ups I add over time, like Basecamp's message
 * board but just for me. Only their owner can ever see or change them; anyone else gets 404.
 */
class DeskNotesIT extends IntegrationTest {

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> items(Map<String, Object> m, String key) {
        return (List<Map<String, Object>>) m.get(key);
    }

    private String note(TestUser u, String title, String body) {
        var r = u.call("POST", "/v1/desk/notes", Map.of("title", title, "body", body));
        assertThat(r.getStatusCode().value()).isEqualTo(201);
        return (String) r.getBody().get("id");
    }

    @Test
    void writeEditFollowUpAndDelete() {
        TestUser a = user("notes_owner");
        assertThat(a.get("/v1/desk/notes")).isEmpty();

        String hotels = note(a, "Hotel options", "Three places near the beach.\nSecond line.");
        String ideas = note(a, "", "Untitled thoughts");

        // Newest change first; the list carries a short snippet, not the whole body.
        List<Map<String, Object>> all = a.get("/v1/desk/notes");
        assertThat(all).extracting(n -> n.get("id")).containsExactly(ideas, hotels);
        assertThat(all.get(1)).containsEntry("title", "Hotel options").containsEntry("snippet", "Three places near the beach. Second line.")
                .containsEntry("followups", 0).containsEntry("pinned", false);

        // Follow-ups: a running log on the note, oldest first. Adding one moves the note to the top.
        assertThat(a.status("POST", "/v1/desk/notes/" + hotels + "/followups", Map.of("body", "Called, the second one is full"))).isEqualTo(201);
        var second = a.call("POST", "/v1/desk/notes/" + hotels + "/followups", Map.of("body", "Booked the third"));
        String followupId = (String) second.getBody().get("id");
        Map<String, Object> view = a.call("GET", "/v1/desk/notes/" + hotels, null).getBody();
        assertThat(view).containsEntry("body", "Three places near the beach.\nSecond line.");
        assertThat(items(view, "followups")).extracting(f -> f.get("body")).containsExactly("Called, the second one is full", "Booked the third");
        assertThat(a.get("/v1/desk/notes")).extracting(n -> n.get("id")).containsExactly(hotels, ideas);
        assertThat(a.get("/v1/desk/notes").get(0)).containsEntry("followups", 2);

        assertThat(a.status("DELETE", "/v1/desk/notes/" + hotels + "/followups/" + followupId, null)).isEqualTo(200);
        assertThat(items(a.call("GET", "/v1/desk/notes/" + hotels, null).getBody(), "followups")).hasSize(1);

        // Edit, and pinned notes stay on top.
        var put = a.call("PUT", "/v1/desk/notes/" + ideas, Map.of("title", "Ideas", "body", "Better thoughts", "pinned", true));
        assertThat(put.getStatusCode().value()).isEqualTo(200);
        assertThat(put.getBody()).containsEntry("title", "Ideas").containsEntry("pinned", true);
        a.call("POST", "/v1/desk/notes/" + hotels + "/followups", Map.of("body", "Paid the deposit"));
        assertThat(a.get("/v1/desk/notes")).extracting(n -> n.get("id")).containsExactly(ideas, hotels);

        assertThat(a.status("DELETE", "/v1/desk/notes/" + hotels, null)).isEqualTo(200);
        assertThat(a.status("GET", "/v1/desk/notes/" + hotels, null)).isEqualTo(404);
        assertThat(a.get("/v1/desk/notes")).hasSize(1);
    }

    @Test
    void aNoteNeedsSomething() {
        TestUser a = user("notes_invalid");
        assertThat(a.status("POST", "/v1/desk/notes", Map.of("title", "  ", "body", " \n "))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/notes", Map.of("title", "x".repeat(201), "body", ""))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/notes", Map.of("title", "", "body", "x".repeat(50_001)))).isEqualTo(400);
        String id = note(a, "Ok", "");
        assertThat(a.status("POST", "/v1/desk/notes/" + id + "/followups", Map.of("body", "   "))).isEqualTo(400);
    }

    @Test
    void nobodyElseCanSeeOrTouchMyNotes() {
        TestUser a = user("notes_mine");
        TestUser b = user("notes_snoop");
        a.befriend(b, List.of(1), List.of(1));
        String id = note(a, "Diary", "Private");
        String f = (String) a.call("POST", "/v1/desk/notes/" + id + "/followups", Map.of("body", "More private")).getBody().get("id");

        assertThat(b.get("/v1/desk/notes")).isEmpty();
        assertThat(b.status("GET", "/v1/desk/notes/" + id, null)).isEqualTo(404);
        assertThat(b.status("PUT", "/v1/desk/notes/" + id, Map.of("title", "x", "body", "y", "pinned", false))).isEqualTo(404);
        assertThat(b.status("DELETE", "/v1/desk/notes/" + id, null)).isEqualTo(404);
        assertThat(b.status("POST", "/v1/desk/notes/" + id + "/followups", Map.of("body", "hi"))).isEqualTo(404);
        assertThat(b.status("DELETE", "/v1/desk/notes/" + id + "/followups/" + f, null)).isEqualTo(404);
        // A follow-up can't be deleted through another note of mine either.
        String other = note(a, "Other", "x");
        assertThat(a.status("DELETE", "/v1/desk/notes/" + other + "/followups/" + f, null)).isEqualTo(404);

        assertThat(items(a.call("GET", "/v1/desk/notes/" + id, null).getBody(), "followups")).hasSize(1);
    }
}
