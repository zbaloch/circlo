package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.assertj.core.groups.Tuple;
import org.junit.jupiter.api.Test;

/**
 * Desk boards and to-dos (owner decision 2026-11-14, boards 2026-11-15): boards that each have a list of to-dos, with
 * due dates and repeats, that only their owner can ever see or change. Anyone else gets 404, exactly as if the board or
 * to-do didn't exist.
 */
class DeskTodosIT extends IntegrationTest {

    private static final String TODAY = LocalDate.now().toString();

    static String board(TestUser u, String name) {
        var r = u.call("POST", "/v1/desk/boards", Map.of("name", name));
        assertThat(r.getStatusCode().value()).isEqualTo(201);
        assertThat(r.getBody()).containsEntry("name", name).containsEntry("todos", 0).containsEntry("notes", 0).containsEntry("files", 0);
        return (String) r.getBody().get("id");
    }

    static Map<String, Object> todo(TestUser u, String boardId, String title, String due, Map<String, Object> repeat) {
        Map<String, Object> body = new HashMap<>(Map.of("boardId", boardId, "title", title));
        if (due != null) body.put("dueDate", due);
        if (repeat != null) body.put("repeat", repeat);
        var r = u.call("POST", "/v1/desk/todos", body);
        assertThat(r.getStatusCode().value()).as("create to-do").isEqualTo(201);
        return r.getBody();
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> items(Map<String, Object> m, String key) {
        return (List<Map<String, Object>>) m.get(key);
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> part(Map<String, Object> m, String key) {
        return (Map<String, Object>) m.get(key);
    }

    private Map<String, Object> todos(TestUser u, String boardId) {
        return u.call("GET", "/v1/desk/boards/" + boardId + "/todos", null).getBody();
    }

    @Test
    void boardsAndTodos() {
        TestUser a = user("desk_boards");
        assertThat(a.get("/v1/desk/boards")).isEmpty();
        String home = board(a, "Home");
        String bills = board(a, "Bills");

        Map<String, Object> t = todo(a, home, "Fix the tap", null, null);
        assertThat(t).containsEntry("title", "Fix the tap").containsEntry("description", "").containsEntry("boardId", home)
                .containsEntry("boardName", "Home").containsEntry("doneAt", null).containsEntry("dueDate", null).containsEntry("repeat", null)
                .containsEntry("commentCount", 0);
        todo(a, home, "Clean gutters", "2026-12-01", null);

        // Boards by name, with how many open to-dos each has.
        assertThat(a.get("/v1/desk/boards")).extracting(b -> b.get("name"), b -> b.get("todos"))
                .containsExactly(Tuple.tuple("Bills", 0), Tuple.tuple("Home", 2));
        assertThat(a.call("GET", "/v1/desk/boards/" + home, null).getBody()).containsEntry("name", "Home").containsEntry("todos", 2);

        // Edit: title, description, due date and moving it to another board.
        String id = (String) t.get("id");
        var put = a.call("PUT", "/v1/desk/todos/" + id,
                Map.of("boardId", bills, "title", "Fix the kitchen tap", "description", "Washer is 1/2 inch", "dueDate", TODAY));
        assertThat(put.getStatusCode().value()).isEqualTo(200);
        assertThat(put.getBody()).containsEntry("boardId", bills).containsEntry("description", "Washer is 1/2 inch").containsEntry("dueDate", TODAY);
        assertThat(items(todos(a, bills), "open")).extracting(x -> x.get("title")).containsExactly("Fix the kitchen tap");

        // Ticked off: moves to done; undo brings it back.
        var done = a.call("POST", "/v1/desk/todos/" + id + "/done", Map.of("today", TODAY));
        assertThat(done.getStatusCode().value()).isEqualTo(200);
        assertThat(part(done.getBody(), "todo").get("doneAt")).isNotNull();
        assertThat(done.getBody().get("next")).isNull();
        assertThat(items(todos(a, bills), "open")).isEmpty();
        assertThat(items(todos(a, bills), "done")).extracting(x -> x.get("title")).containsExactly("Fix the kitchen tap");
        assertThat(a.status("DELETE", "/v1/desk/todos/" + id + "/done", null)).isEqualTo(200);
        assertThat(items(todos(a, bills), "open")).hasSize(1);

        // Rename and delete a board (its to-dos go with it).
        assertThat(a.call("PUT", "/v1/desk/boards/" + home, Map.of("name", "House")).getBody()).containsEntry("name", "House");
        assertThat(a.status("DELETE", "/v1/desk/boards/" + bills, null)).isEqualTo(200);
        assertThat(a.status("GET", "/v1/desk/todos/" + id, null)).isEqualTo(404);
        assertThat(a.status("GET", "/v1/desk/boards/" + bills, null)).isEqualTo(404);
        assertThat(a.get("/v1/desk/boards")).extracting(b -> b.get("name")).containsExactly("House");
    }

    @Test
    void todayGathersWhatIsDueAcrossBoards() {
        TestUser a = user("desk_today");
        String home = board(a, "Home");
        String work = board(a, "Work");
        LocalDate today = LocalDate.parse(TODAY);
        todo(a, home, "Overdue", today.minusDays(2).toString(), null);
        todo(a, work, "Due today", TODAY, null);
        todo(a, home, "Next week", today.plusDays(7).toString(), null);
        todo(a, home, "Someday", null, null);
        String finished = (String) todo(a, work, "Already done", TODAY, null).get("id");
        a.call("POST", "/v1/desk/todos/" + finished + "/done", Map.of("today", TODAY));

        List<Map<String, Object>> due = a.get("/v1/desk/today?date=" + TODAY);
        assertThat(due).extracting(x -> x.get("title")).containsExactly("Overdue", "Due today");
        assertThat(due).extracting(x -> x.get("boardName")).containsExactly("Home", "Work");
    }

    @Test
    void repeatingTodosComeBackWhenDone() {
        TestUser a = user("desk_repeat");
        String home = board(a, "Chores");
        LocalDate today = LocalDate.parse(TODAY);

        Map<String, Object> plants = todo(a, home, "Water plants", TODAY, Map.of("kind", "after", "every", 7));
        assertThat(plants.get("repeat")).isEqualTo(Map.of("kind", "after", "every", 7));
        String id = (String) plants.get("id");
        a.call("PUT", "/v1/desk/todos/" + id, Map.of("boardId", home, "title", "Water plants", "description", "The ferns too", "dueDate", TODAY,
                "repeat", Map.of("kind", "after", "every", 7)));

        var done = a.call("POST", "/v1/desk/todos/" + id + "/done", Map.of("today", TODAY));
        Map<String, Object> next = part(done.getBody(), "next");
        assertThat(next).containsEntry("title", "Water plants").containsEntry("description", "The ferns too")
                .containsEntry("dueDate", today.plusDays(7).toString()).containsEntry("doneAt", null);
        assertThat(next.get("repeat")).isEqualTo(Map.of("kind", "after", "every", 7));

        // The next one remembers when it was done before.
        String nextId = (String) next.get("id");
        Map<String, Object> view = a.call("GET", "/v1/desk/todos/" + nextId, null).getBody();
        assertThat(part(view, "todo")).containsEntry("id", nextId);
        assertThat(items(view, "history")).hasSize(1);
        assertThat(items(view, "history").get(0).get("dueDate")).isEqualTo(TODAY);
        assertThat(items(view, "comments")).isEmpty();

        // Undo takes back the one it made, as long as that hasn't been done itself.
        assertThat(a.status("DELETE", "/v1/desk/todos/" + id + "/done", null)).isEqualTo(200);
        assertThat(a.status("GET", "/v1/desk/todos/" + nextId, null)).isEqualTo(404);
        assertThat(items(todos(a, home), "open")).extracting(x -> x.get("id")).containsExactly(id);

        // A weekly one.
        String weekly = (String) todo(a, home, "Bins out", TODAY, Map.of("kind", "weekly", "every", 1)).get("id");
        next = part(a.call("POST", "/v1/desk/todos/" + weekly + "/done", Map.of("today", TODAY)).getBody(), "next");
        assertThat(next.get("dueDate")).isEqualTo(today.plusWeeks(1).toString());
    }

    @Test
    void invalidInputIsRejected() {
        TestUser a = user("desk_invalid");
        String home = board(a, "Home");
        assertThat(a.status("POST", "/v1/desk/boards", Map.of("name", "   "))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/boards", Map.of("name", "two\nlines"))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/todos", Map.of("boardId", home, "title", ""))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/todos", Map.of("boardId", home, "title", "x".repeat(501)))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/todos", Map.of("boardId", home, "title", "x", "description", "y".repeat(10_001)))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/todos", Map.of("boardId", home, "title", "x", "dueDate", "tomorrow"))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/todos",
                Map.of("boardId", home, "title", "x", "dueDate", TODAY, "repeat", Map.of("kind", "hourly", "every", 1)))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/todos",
                Map.of("boardId", home, "title", "x", "dueDate", TODAY, "repeat", Map.of("kind", "daily", "every", 0)))).isEqualTo(400);
        // A scheduled repeat needs a due date to count from.
        assertThat(a.status("POST", "/v1/desk/todos",
                Map.of("boardId", home, "title", "x", "repeat", Map.of("kind", "weekly", "every", 1)))).isEqualTo(400);
        // "Today" must be close to the server's today (time zones are at most a day apart).
        String id = (String) todo(a, home, "x", null, null).get("id");
        assertThat(a.status("POST", "/v1/desk/todos/" + id + "/done", Map.of("today", "2001-01-01"))).isEqualTo(400);
    }

    @Test
    void nobodyElseCanSeeOrTouchMyBoardsOrTodos() {
        TestUser a = user("desk_owner");
        TestUser b = user("desk_snoop");
        // Even a friend.
        a.befriend(b, List.of(1), List.of(1));
        String home = board(a, "Home");
        String id = (String) todo(a, home, "Private thing", TODAY, null).get("id");

        assertThat(b.get("/v1/desk/boards")).isEmpty();
        assertThat(b.get("/v1/desk/today?date=" + TODAY)).isEmpty();
        assertThat(b.status("GET", "/v1/desk/boards/" + home, null)).isEqualTo(404);
        assertThat(b.status("GET", "/v1/desk/boards/" + home + "/todos", null)).isEqualTo(404);
        assertThat(b.status("PUT", "/v1/desk/boards/" + home, Map.of("name", "Mine now"))).isEqualTo(404);
        assertThat(b.status("DELETE", "/v1/desk/boards/" + home, null)).isEqualTo(404);
        assertThat(b.status("GET", "/v1/desk/todos/" + id, null)).isEqualTo(404);
        assertThat(b.status("PUT", "/v1/desk/todos/" + id, Map.of("boardId", home, "title", "changed"))).isEqualTo(404);
        assertThat(b.status("POST", "/v1/desk/todos/" + id + "/done", Map.of("today", TODAY))).isEqualTo(404);
        assertThat(b.status("DELETE", "/v1/desk/todos/" + id + "/done", null)).isEqualTo(404);
        assertThat(b.status("DELETE", "/v1/desk/todos/" + id, null)).isEqualTo(404);
        // Can't add to my board or move their to-do into it.
        assertThat(b.status("POST", "/v1/desk/todos", Map.of("boardId", home, "title", "sneaky"))).isEqualTo(404);
        String theirs = board(b, "Theirs");
        String theirTodo = (String) todo(b, theirs, "Theirs", null, null).get("id");
        assertThat(b.status("PUT", "/v1/desk/todos/" + theirTodo, Map.of("boardId", home, "title", "moved"))).isEqualTo(404);

        assertThat(part(a.call("GET", "/v1/desk/todos/" + id, null).getBody(), "todo")).containsEntry("title", "Private thing");
        assertThat(items(todos(a, home), "open")).hasSize(1);
    }
}
