package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Desk to-dos (owner decision 2026-11-14): lists of to-dos, with due dates and repeats, that only their owner can ever
 * see or change. Anyone else gets 404, exactly as if the list or to-do didn't exist.
 */
class DeskTodosIT extends IntegrationTest {

    private static final String TODAY = LocalDate.now().toString();

    private String list(TestUser u, String name) {
        var r = u.call("POST", "/v1/desk/lists", Map.of("name", name));
        assertThat(r.getStatusCode().value()).isEqualTo(201);
        assertThat(r.getBody()).containsEntry("name", name).containsEntry("open", 0);
        return (String) r.getBody().get("id");
    }

    private Map<String, Object> todo(TestUser u, String listId, String title, String due, Map<String, Object> repeat) {
        Map<String, Object> body = new HashMap<>(Map.of("listId", listId, "title", title));
        if (due != null) body.put("dueDate", due);
        if (repeat != null) body.put("repeat", repeat);
        var r = u.call("POST", "/v1/desk/todos", body);
        assertThat(r.getStatusCode().value()).as("create to-do").isEqualTo(201);
        return r.getBody();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> items(Map<String, Object> m, String key) {
        return (List<Map<String, Object>>) m.get(key);
    }

    @Test
    void listsAndTodos() {
        TestUser a = user("desk_lists");
        assertThat(a.get("/v1/desk/lists")).isEmpty();
        String home = list(a, "Home");
        String bills = list(a, "Bills");

        Map<String, Object> t = todo(a, home, "Fix the tap", null, null);
        assertThat(t).containsEntry("title", "Fix the tap").containsEntry("listId", home).containsEntry("doneAt", null)
                .containsEntry("dueDate", null).containsEntry("repeat", null);
        todo(a, home, "Clean gutters", "2026-12-01", null);

        assertThat(a.get("/v1/desk/lists")).extracting(l -> l.get("name"), l -> l.get("open"))
                .containsExactly(org.assertj.core.groups.Tuple.tuple("Home", 2), org.assertj.core.groups.Tuple.tuple("Bills", 0));

        // Edit: title, notes, due date and moving it to another list.
        String id = (String) t.get("id");
        var put = a.call("PUT", "/v1/desk/todos/" + id,
                Map.of("listId", bills, "title", "Fix the kitchen tap", "notes", "Washer is 1/2 inch", "dueDate", TODAY));
        assertThat(put.getStatusCode().value()).isEqualTo(200);
        assertThat(put.getBody()).containsEntry("listId", bills).containsEntry("notes", "Washer is 1/2 inch").containsEntry("dueDate", TODAY);

        Map<String, Object> billsView = a.call("GET", "/v1/desk/lists/" + bills, null).getBody();
        assertThat(billsView).containsEntry("name", "Bills");
        assertThat(items(billsView, "open")).extracting(x -> x.get("title")).containsExactly("Fix the kitchen tap");

        // Ticked off: moves to done; undo brings it back.
        var done = a.call("POST", "/v1/desk/todos/" + id + "/done", Map.of("today", TODAY));
        assertThat(done.getStatusCode().value()).isEqualTo(200);
        assertThat(((Map<?, ?>) done.getBody().get("todo")).get("doneAt")).isNotNull();
        assertThat(done.getBody().get("next")).isNull();
        billsView = a.call("GET", "/v1/desk/lists/" + bills, null).getBody();
        assertThat(items(billsView, "open")).isEmpty();
        assertThat(items(billsView, "done")).extracting(x -> x.get("title")).containsExactly("Fix the kitchen tap");
        assertThat(a.status("DELETE", "/v1/desk/todos/" + id + "/done", null)).isEqualTo(200);
        assertThat(items(a.call("GET", "/v1/desk/lists/" + bills, null).getBody(), "open")).hasSize(1);

        // Rename and delete a list (its to-dos go with it).
        assertThat(a.status("PUT", "/v1/desk/lists/" + home, Map.of("name", "House"))).isEqualTo(200);
        assertThat(a.status("DELETE", "/v1/desk/lists/" + bills, null)).isEqualTo(200);
        assertThat(a.status("GET", "/v1/desk/todos/" + id, null)).isEqualTo(404);
        assertThat(a.get("/v1/desk/lists")).extracting(l -> l.get("name")).containsExactly("House");
    }

    @Test
    void todayGathersWhatIsDueAcrossLists() {
        TestUser a = user("desk_today");
        String home = list(a, "Home");
        String work = list(a, "Work");
        LocalDate today = LocalDate.parse(TODAY);
        todo(a, home, "Overdue", today.minusDays(2).toString(), null);
        todo(a, work, "Due today", TODAY, null);
        todo(a, home, "Next week", today.plusDays(7).toString(), null);
        todo(a, home, "Someday", null, null);
        String finished = (String) todo(a, work, "Already done", TODAY, null).get("id");
        a.call("POST", "/v1/desk/todos/" + finished + "/done", Map.of("today", TODAY));

        List<Map<String, Object>> due = a.get("/v1/desk/today?date=" + TODAY);
        assertThat(due).extracting(x -> x.get("title")).containsExactly("Overdue", "Due today");
        assertThat(due).extracting(x -> x.get("listName")).containsExactly("Home", "Work");
    }

    @Test
    void repeatingTodosComeBackWhenDone() {
        TestUser a = user("desk_repeat");
        String home = list(a, "Chores");
        LocalDate today = LocalDate.parse(TODAY);

        Map<String, Object> plants = todo(a, home, "Water plants", TODAY, Map.of("kind", "after", "every", 7));
        assertThat(plants.get("repeat")).isEqualTo(Map.of("kind", "after", "every", 7));
        String id = (String) plants.get("id");

        var done = a.call("POST", "/v1/desk/todos/" + id + "/done", Map.of("today", TODAY));
        Map<?, ?> next = (Map<?, ?>) done.getBody().get("next");
        assertThat(next.get("title")).isEqualTo("Water plants");
        assertThat(next.get("dueDate")).isEqualTo(today.plusDays(7).toString());
        assertThat(next.get("repeat")).isEqualTo(Map.of("kind", "after", "every", 7));
        assertThat(next.get("doneAt")).isNull();

        // The next one remembers when it was done before.
        String nextId = (String) next.get("id");
        Map<String, Object> view = a.call("GET", "/v1/desk/todos/" + nextId, null).getBody();
        assertThat(items(view, "history")).hasSize(1);
        assertThat(items(view, "history").get(0).get("dueDate")).isEqualTo(TODAY);

        // Undo takes back the one it made, as long as that hasn't been done itself.
        assertThat(a.status("DELETE", "/v1/desk/todos/" + id + "/done", null)).isEqualTo(200);
        assertThat(a.status("GET", "/v1/desk/todos/" + nextId, null)).isEqualTo(404);
        assertThat(items(a.call("GET", "/v1/desk/lists/" + home, null).getBody(), "open")).extracting(x -> x.get("id")).containsExactly(id);

        // A weekly one.
        String weekly = (String) todo(a, home, "Bins out", TODAY, Map.of("kind", "weekly", "every", 1)).get("id");
        next = (Map<?, ?>) a.call("POST", "/v1/desk/todos/" + weekly + "/done", Map.of("today", TODAY)).getBody().get("next");
        assertThat(next.get("dueDate")).isEqualTo(today.plusWeeks(1).toString());
    }

    @Test
    void invalidInputIsRejected() {
        TestUser a = user("desk_invalid");
        String home = list(a, "Home");
        assertThat(a.status("POST", "/v1/desk/lists", Map.of("name", "   "))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/todos", Map.of("listId", home, "title", ""))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/todos", Map.of("listId", home, "title", "x".repeat(501)))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/todos", Map.of("listId", home, "title", "x", "dueDate", "tomorrow"))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/todos",
                Map.of("listId", home, "title", "x", "dueDate", TODAY, "repeat", Map.of("kind", "hourly", "every", 1)))).isEqualTo(400);
        assertThat(a.status("POST", "/v1/desk/todos",
                Map.of("listId", home, "title", "x", "dueDate", TODAY, "repeat", Map.of("kind", "daily", "every", 0)))).isEqualTo(400);
        // A scheduled repeat needs a due date to count from.
        assertThat(a.status("POST", "/v1/desk/todos",
                Map.of("listId", home, "title", "x", "repeat", Map.of("kind", "weekly", "every", 1)))).isEqualTo(400);
        // "Today" must be close to the server's today (time zones are at most a day apart).
        String id = (String) todo(a, home, "x", null, null).get("id");
        assertThat(a.status("POST", "/v1/desk/todos/" + id + "/done", Map.of("today", "2001-01-01"))).isEqualTo(400);
    }

    @Test
    void nobodyElseCanSeeOrTouchMyTodos() {
        TestUser a = user("desk_owner");
        TestUser b = user("desk_snoop");
        // Even a friend.
        a.befriend(b, List.of(1), List.of(1));
        String home = list(a, "Home");
        String id = (String) todo(a, home, "Private thing", TODAY, null).get("id");

        assertThat(b.get("/v1/desk/lists")).isEmpty();
        assertThat(b.get("/v1/desk/today?date=" + TODAY)).isEmpty();
        assertThat(b.status("GET", "/v1/desk/lists/" + home, null)).isEqualTo(404);
        assertThat(b.status("PUT", "/v1/desk/lists/" + home, Map.of("name", "Mine now"))).isEqualTo(404);
        assertThat(b.status("DELETE", "/v1/desk/lists/" + home, null)).isEqualTo(404);
        assertThat(b.status("GET", "/v1/desk/todos/" + id, null)).isEqualTo(404);
        assertThat(b.status("PUT", "/v1/desk/todos/" + id, Map.of("listId", home, "title", "changed"))).isEqualTo(404);
        assertThat(b.status("POST", "/v1/desk/todos/" + id + "/done", Map.of("today", TODAY))).isEqualTo(404);
        assertThat(b.status("DELETE", "/v1/desk/todos/" + id + "/done", null)).isEqualTo(404);
        assertThat(b.status("DELETE", "/v1/desk/todos/" + id, null)).isEqualTo(404);
        // Can't add to my list or move their to-do into it.
        assertThat(b.status("POST", "/v1/desk/todos", Map.of("listId", home, "title", "sneaky"))).isEqualTo(404);
        String theirs = list(b, "Theirs");
        String theirTodo = (String) todo(b, theirs, "Theirs", null, null).get("id");
        assertThat(b.status("PUT", "/v1/desk/todos/" + theirTodo, Map.of("listId", home, "title", "moved"))).isEqualTo(404);

        Map<String, Object> mine = a.call("GET", "/v1/desk/todos/" + id, null).getBody();
        assertThat(mine).containsEntry("title", "Private thing");
        assertThat(items(a.call("GET", "/v1/desk/lists/" + home, null).getBody(), "open")).hasSize(1);
    }
}
