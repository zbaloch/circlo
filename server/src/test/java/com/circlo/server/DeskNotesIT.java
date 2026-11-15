package com.circlo.server;

import static com.circlo.server.DeskTodosIT.board;
import static com.circlo.server.DeskTodosIT.items;
import static com.circlo.server.DeskTodosIT.part;
import static com.circlo.server.DeskTodosIT.todo;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Desk notes and comments (owner decision 2026-11-14, boards 2026-11-15): notes on a board, like messages with one
 * reader, and comments on to-dos, notes and files. Only their owner can ever see or change them; anyone else gets 404.
 */
class DeskNotesIT extends IntegrationTest {

    private static String note(TestUser u, String boardId, String title, String description) {
        Map<String, Object> body = new HashMap<>(Map.of("boardId", boardId, "title", title));
        if (description != null) body.put("description", description);
        var r = u.call("POST", "/v1/desk/notes", body);
        assertThat(r.getStatusCode().value()).as("create note").isEqualTo(201);
        return (String) r.getBody().get("id");
    }

    private static Map<String, Object> comment(TestUser u, String kind, String id, String body) {
        var r = u.call("POST", "/v1/desk/" + kind + "/" + id + "/comments", Map.of("body", body));
        assertThat(r.getStatusCode().value()).as("comment").isEqualTo(201);
        return r.getBody();
    }

    @Test
    void writeEditPinAndDelete() {
        TestUser a = user("notes_owner");
        String trip = board(a, "Karachi trip");
        String hotels = note(a, trip, "Hotels", "Pearl Continental or Movenpick.\n\nAsk about the airport shuttle.");
        String packing = note(a, trip, "Packing", null);

        Map<String, Object> view = a.call("GET", "/v1/desk/notes/" + hotels, null).getBody();
        assertThat(part(view, "note")).containsEntry("title", "Hotels").containsEntry("boardId", trip).containsEntry("boardName", "Karachi trip")
                .containsEntry("pinned", false).containsEntry("description", "Pearl Continental or Movenpick.\n\nAsk about the airport shuttle.");
        assertThat(items(view, "comments")).isEmpty();

        // The board's notes: newest change first, a one-line snippet of the description.
        List<Map<String, Object>> list = a.list("GET", "/v1/desk/boards/" + trip + "/notes", null).getBody();
        assertThat(list).extracting(n -> n.get("title")).containsExactly("Packing", "Hotels");
        assertThat(list.get(1)).containsEntry("snippet", "Pearl Continental or Movenpick. Ask about the airport shuttle.").containsEntry("commentCount", 0);
        assertThat(list.get(0)).containsEntry("snippet", "");
        assertThat(a.call("GET", "/v1/desk/boards/" + trip, null).getBody()).containsEntry("notes", 2);

        // Pinned goes first; a comment moves a note up among the rest.
        var pinned = a.call("PUT", "/v1/desk/notes/" + hotels, Map.of("boardId", trip, "title", "Hotels", "description", "Booked the PC.", "pinned", true));
        assertThat(pinned.getBody()).containsEntry("pinned", true).containsEntry("description", "Booked the PC.");
        assertThat(a.list("GET", "/v1/desk/boards/" + trip + "/notes", null).getBody()).extracting(n -> n.get("title")).containsExactly("Hotels", "Packing");

        // Moving it to another board.
        String home = board(a, "Home");
        a.call("PUT", "/v1/desk/notes/" + packing, Map.of("boardId", home, "title", "Packing list", "description", ""));
        assertThat(a.list("GET", "/v1/desk/boards/" + home + "/notes", null).getBody()).extracting(n -> n.get("title")).containsExactly("Packing list");

        assertThat(a.status("DELETE", "/v1/desk/notes/" + hotels, null)).isEqualTo(200);
        assertThat(a.status("GET", "/v1/desk/notes/" + hotels, null)).isEqualTo(404);
    }

    @Test
    void aNoteNeedsATitle() {
        TestUser a = user("notes_empty");
        String b = board(a, "B");
        assertThat(a.status("POST", "/v1/desk/notes", Map.of("boardId", b, "title", "  ", "description", "words"))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/notes", Map.of("boardId", b, "title", "a\nb"))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/notes", Map.of("boardId", b, "title", "x".repeat(201)))).isEqualTo(400);
    }

    @Test
    void commentsOnTodosAndNotes() {
        TestUser a = user("comments_owner");
        String b = board(a, "Garden");
        String todo = (String) todo(a, b, "Plant tulips", null, null).get("id");
        String n = note(a, b, "Ideas", "Raised beds");

        Map<String, Object> c1 = comment(a, "todos", todo, "Bought 40 bulbs");
        assertThat(c1).containsEntry("body", "Bought 40 bulbs");
        assertThat(c1.get("createdAt")).isNotNull();
        comment(a, "todos", todo, "Half planted");
        comment(a, "notes", n, "Cedar is best");

        Map<String, Object> view = a.call("GET", "/v1/desk/todos/" + todo, null).getBody();
        assertThat(items(view, "comments")).extracting(c -> c.get("body")).containsExactly("Bought 40 bulbs", "Half planted");
        assertThat(part(view, "todo")).containsEntry("commentCount", 2);
        assertThat(items(a.call("GET", "/v1/desk/boards/" + b + "/todos", null).getBody(), "open").get(0)).containsEntry("commentCount", 2);
        assertThat(a.list("GET", "/v1/desk/boards/" + b + "/notes", null).getBody().get(0)).containsEntry("commentCount", 1);

        // Deleting a comment; deleting the to-do takes its comments with it.
        assertThat(a.status("DELETE", "/v1/desk/comments/" + c1.get("id"), null)).isEqualTo(200);
        assertThat(items(a.call("GET", "/v1/desk/todos/" + todo, null).getBody(), "comments")).hasSize(1);
        assertThat(a.status("POST", "/v1/desk/todos/" + todo + "/comments", Map.of("body", "  "))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/todos/" + todo + "/comments", Map.of("body", "x".repeat(5001)))).isEqualTo(400);
        assertThat(a.status("DELETE", "/v1/desk/todos/" + todo, null)).isEqualTo(200);
        assertThat(a.status("POST", "/v1/desk/todos/" + todo + "/comments", Map.of("body", "late"))).isEqualTo(404);
    }

    @Test
    void nobodyElseCanSeeOrTouchMyNotesOrComments() {
        TestUser a = user("notes_mine");
        TestUser b = user("notes_snoop");
        a.befriend(b, List.of(1), List.of(1));
        String board = board(a, "Private");
        String id = note(a, board, "Diary", "Private thoughts");
        String c = (String) comment(a, "notes", id, "More thoughts").get("id");

        assertThat(b.status("GET", "/v1/desk/boards/" + board + "/notes", null)).isEqualTo(404);
        assertThat(b.status("GET", "/v1/desk/notes/" + id, null)).isEqualTo(404);
        assertThat(b.status("PUT", "/v1/desk/notes/" + id, Map.of("boardId", board, "title", "x"))).isEqualTo(404);
        assertThat(b.status("DELETE", "/v1/desk/notes/" + id, null)).isEqualTo(404);
        assertThat(b.status("POST", "/v1/desk/notes", Map.of("boardId", board, "title", "sneaky"))).isEqualTo(404);
        assertThat(b.status("POST", "/v1/desk/notes/" + id + "/comments", Map.of("body", "hi"))).isEqualTo(404);
        assertThat(b.status("DELETE", "/v1/desk/comments/" + c, null)).isEqualTo(404);
        String theirs = board(b, "Theirs");
        String theirNote = note(b, theirs, "Theirs", null);
        assertThat(b.status("PUT", "/v1/desk/notes/" + theirNote, Map.of("boardId", board, "title", "moved"))).isEqualTo(404);

        assertThat(items(a.call("GET", "/v1/desk/notes/" + id, null).getBody(), "comments")).extracting(x -> x.get("body")).containsExactly("More thoughts");
    }
}
