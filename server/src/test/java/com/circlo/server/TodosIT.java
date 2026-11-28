package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.circlo.server.todos.TodosSweep;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Todos (2.0): personal to-do lists. Only their owner can ever see or change them; General is made for everyone and
 * can't be deleted; repeating to-dos come back with their next date when ticked; completed ones are kept 30 days.
 */
class TodosIT extends IntegrationTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private TodosSweep sweep;

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> lists(TestUser u) {
        return (List<Map<String, Object>>) u.call("GET", "/v1/todos", null).getBody().get("lists");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> todos(TestUser u) {
        return (List<Map<String, Object>>) u.call("GET", "/v1/todos", null).getBody().get("todos");
    }

    private static List<Object> titles(List<Map<String, Object>> todos) {
        return todos.stream().map(t -> t.get("title")).toList();
    }

    private static Map<String, Object> add(TestUser u, Map<String, Object> body) {
        ResponseEntity<Map<String, Object>> r = u.call("POST", "/v1/todos", body);
        assertThat(r.getStatusCode().value()).as(r.getBody() == null ? "" : r.getBody().toString()).isEqualTo(201);
        return r.getBody();
    }

    private static Map<String, Object> body(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            m.put((String) kv[i], kv[i + 1]);
        }
        return m;
    }

    @Test
    void everyoneStartsWithGeneralWhereQuickAddPutsThings() {
        TestUser a = user("todo_general");
        assertThat(lists(a)).singleElement().satisfies(l -> assertThat(l).containsEntry("name", "General").containsEntry("general", true));
        assertThat(todos(a)).isEmpty();

        Map<String, Object> t = add(a, body("title", "  Call mum  ", "dueDate", "2026-11-28"));
        assertThat(t).containsEntry("title", "Call mum").containsEntry("dueDate", "2026-11-28").containsEntry("listId", lists(a).get(0).get("listId"))
                .containsEntry("notes", null).containsEntry("repeat", null).containsEntry("completedAt", null);
        // Asking again doesn't make a second General.
        assertThat(lists(a)).hasSize(1);
    }

    @Test
    void listsCanBeAddedRenamedReorderedAndDeletedButNotGeneral() {
        TestUser a = user("todo_lists");
        String general = (String) lists(a).get(0).get("listId");
        String groceries = (String) a.call("POST", "/v1/todos/lists", Map.of("name", "Groceries")).getBody().get("listId");
        String work = (String) a.call("POST", "/v1/todos/lists", Map.of("name", "Work")).getBody().get("listId");
        assertThat(lists(a)).extracting(l -> l.get("name")).containsExactly("General", "Groceries", "Work");

        assertThat(a.call("PUT", "/v1/todos/lists/" + general, Map.of("name", "Inbox")).getBody()).containsEntry("name", "Inbox");
        assertThat(a.call("PUT", "/v1/todos/lists/order", Map.of("listIds", List.of(work, general, groceries))).getStatusCode().value()).isEqualTo(204);
        assertThat(lists(a)).extracting(l -> l.get("name")).containsExactly("Work", "Inbox", "Groceries");

        add(a, body("title", "Milk", "listId", groceries));
        assertThat(a.call("DELETE", "/v1/todos/lists/" + general, null).getBody()).containsEntry("error", "general_list");
        assertThat(a.call("DELETE", "/v1/todos/lists/" + groceries, null).getStatusCode().value()).isEqualTo(204);
        assertThat(lists(a)).extracting(l -> l.get("name")).containsExactly("Work", "Inbox");
        assertThat(todos(a)).isEmpty();

        assertThat(a.call("POST", "/v1/todos/lists", Map.of("name", "  ")).getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void aTodoHasNotesADateARepeatAndAListAndCanBeEdited() {
        TestUser a = user("todo_edit");
        String work = (String) a.call("POST", "/v1/todos/lists", Map.of("name", "Work")).getBody().get("listId");
        Map<String, Object> t = add(a, body("title", "Taxes"));
        String id = (String) t.get("todoId");

        Map<String, Object> edited = a.call("PUT", "/v1/todos/" + id, body("title", "File taxes", "notes", "Forms in the blue folder\nhttps://gov.example",
                "dueDate", "2026-12-10", "repeat", "monthly", "listId", work)).getBody();
        assertThat(edited).containsEntry("title", "File taxes").containsEntry("notes", "Forms in the blue folder\nhttps://gov.example")
                .containsEntry("dueDate", "2026-12-10").containsEntry("repeat", "monthly").containsEntry("listId", work);
        // Clearing the date clears the repeat with it (a repeat needs a date to repeat from).
        assertThat(a.call("PUT", "/v1/todos/" + id, body("title", "File taxes", "notes", null, "dueDate", null, "repeat", "monthly", "listId", work))
                .getBody()).containsEntry("error", "repeat_needs_date");
        assertThat(a.call("PUT", "/v1/todos/" + id, body("title", "File taxes", "dueDate", null, "repeat", null, "listId", work)).getBody())
                .containsEntry("dueDate", null).containsEntry("notes", null);

        assertThat(a.call("POST", "/v1/todos", body("title", "")).getStatusCode().value()).isEqualTo(400);
        assertThat(a.call("POST", "/v1/todos", body("title", "x", "repeat", "yearly", "dueDate", "2026-12-01")).getStatusCode().value()).isEqualTo(400);
        assertThat(a.call("POST", "/v1/todos", body("title", "x", "dueDate", "next tuesday")).getStatusCode().value()).isEqualTo(400);
        assertThat(a.call("DELETE", "/v1/todos/" + id, null).getStatusCode().value()).isEqualTo(204);
        assertThat(todos(a)).isEmpty();
    }

    @Test
    void myOrderInAListIsKept() {
        TestUser a = user("todo_order");
        String one = (String) add(a, body("title", "One")).get("todoId");
        String two = (String) add(a, body("title", "Two")).get("todoId");
        String three = (String) add(a, body("title", "Three")).get("todoId");
        assertThat(titles(todos(a))).containsExactly("One", "Two", "Three");
        String general = (String) lists(a).get(0).get("listId");
        assertThat(a.call("PUT", "/v1/todos/lists/" + general + "/order", Map.of("todoIds", List.of(three, one, two))).getStatusCode().value())
                .isEqualTo(204);
        assertThat(titles(todos(a))).containsExactly("Three", "One", "Two");
    }

    @Test
    @SuppressWarnings("unchecked")
    void tickingMovesItToCompletedAndUntickingBringsItBack() {
        TestUser a = user("todo_tick");
        String id = (String) add(a, body("title", "Buy cake")).get("todoId");
        Map<String, Object> done = a.call("POST", "/v1/todos/" + id + "/complete", Map.of("today", "2026-11-27")).getBody();
        assertThat((Map<String, Object>) done.get("completed")).containsEntry("todoId", id).doesNotContainEntry("completedAt", null);
        assertThat(done).containsEntry("next", null);
        assertThat(todos(a)).isEmpty();

        String general = (String) lists(a).get(0).get("listId");
        List<Map<String, Object>> completed = a.list("GET", "/v1/todos/lists/" + general + "/completed", null).getBody();
        assertThat(titles(completed)).containsExactly("Buy cake");

        // Also across all my lists, and only mine.
        String work = (String) a.call("POST", "/v1/todos/lists", Map.of("name", "Work")).getBody().get("listId");
        String report = (String) add(a, body("title", "Report", "listId", work)).get("todoId");
        a.call("POST", "/v1/todos/" + report + "/complete", Map.of("today", "2026-11-27"));
        assertThat(titles(a.list("GET", "/v1/todos/completed", null).getBody())).containsExactly("Report", "Buy cake");
        assertThat(user("todo_tick_other").list("GET", "/v1/todos/completed", null).getBody()).isEmpty();

        assertThat(a.call("POST", "/v1/todos/" + id + "/reopen", null).getBody()).containsEntry("completedAt", null);
        assertThat(titles(todos(a))).containsExactly("Buy cake");
        assertThat(a.list("GET", "/v1/todos/lists/" + general + "/completed", null).getBody()).isEmpty();
    }

    @Test
    @SuppressWarnings("unchecked")
    void repeatingTodosComeBackWithTheirNextDate() {
        TestUser a = user("todo_repeat");
        // Weekly, ticked on time: next week.
        String plants = (String) add(a, body("title", "Water plants", "dueDate", "2026-11-23", "repeat", "weekly")).get("todoId");
        Map<String, Object> done = a.call("POST", "/v1/todos/" + plants + "/complete", Map.of("today", "2026-11-23")).getBody();
        Map<String, Object> next = (Map<String, Object>) done.get("next");
        assertThat(next).containsEntry("title", "Water plants").containsEntry("dueDate", "2026-11-30").containsEntry("repeat", "weekly");
        // The ticked one is a one-off in Completed now; unticking it doesn't start a second series.
        assertThat((Map<String, Object>) done.get("completed")).containsEntry("repeat", null);

        // Monthly, ticked late: the next date after today, keeping its day of the month (no drift from the 31st).
        String rent = (String) add(a, body("title", "Pay rent", "dueDate", "2026-08-31", "repeat", "monthly")).get("todoId");
        next = (Map<String, Object>) a.call("POST", "/v1/todos/" + rent + "/complete", Map.of("today", "2026-11-27")).getBody().get("next");
        assertThat(next).containsEntry("dueDate", "2026-11-30");
        next = (Map<String, Object>) a.call("POST", "/v1/todos/" + next.get("todoId") + "/complete", Map.of("today", "2026-11-30")).getBody().get("next");
        assertThat(next).containsEntry("dueDate", "2026-12-31");

        // Daily, three days overdue: tomorrow.
        String walk = (String) add(a, body("title", "Walk", "dueDate", "2026-11-24", "repeat", "daily")).get("todoId");
        next = (Map<String, Object>) a.call("POST", "/v1/todos/" + walk + "/complete", Map.of("today", "2026-11-27")).getBody().get("next");
        assertThat(next).containsEntry("dueDate", "2026-11-28");

        assertThat(titles(todos(a))).containsExactlyInAnyOrder("Water plants", "Pay rent", "Walk");
    }

    @Test
    void myTodosAreMineAlone() {
        TestUser a = user("todo_mine");
        TestUser b = user("todo_theirs");
        String id = (String) add(a, body("title", "Secret plan", "notes", "Nobody else")).get("todoId");
        String list = (String) lists(a).get(0).get("listId");

        assertThat(todos(b)).isEmpty();
        for (String[] call : List.of(new String[] {"PUT", "/v1/todos/" + id}, new String[] {"DELETE", "/v1/todos/" + id},
                new String[] {"POST", "/v1/todos/" + id + "/complete"}, new String[] {"POST", "/v1/todos/" + id + "/reopen"},
                new String[] {"PUT", "/v1/todos/lists/" + list}, new String[] {"DELETE", "/v1/todos/lists/" + list},
                new String[] {"GET", "/v1/todos/lists/" + list + "/completed"})) {
            Object payload = call[0].equals("PUT") ? body("title", "Mine now", "name", "Mine now") : call[1].endsWith("complete") ? Map.of("today", "2026-11-27") : null;
            assertThat(b.call(call[0], call[1], payload).getStatusCode().value()).as(call[0] + " " + call[1]).isEqualTo(404);
        }
        // Not into someone else's list either.
        assertThat(b.call("POST", "/v1/todos", body("title", "Sneaky", "listId", list)).getStatusCode().value()).isEqualTo(404);
        assertThat(b.call("PUT", "/v1/todos/lists/" + list + "/order", Map.of("todoIds", List.of(id))).getStatusCode().value()).isEqualTo(404);
        assertThat(titles(todos(a))).containsExactly("Secret plan");
        assertThat(call("GET", "/v1/todos", null, null).getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void completedTodosAreLetGoAfter30Days() {
        TestUser a = user("todo_sweep");
        String old = (String) add(a, body("title", "Old")).get("todoId");
        String recent = (String) add(a, body("title", "Recent")).get("todoId");
        a.call("POST", "/v1/todos/" + old + "/complete", Map.of("today", "2026-11-27"));
        a.call("POST", "/v1/todos/" + recent + "/complete", Map.of("today", "2026-11-27"));
        jdbc.update("UPDATE todos SET completed_at = ? WHERE id = ?", Timestamp.from(Instant.now().minus(Duration.ofDays(31))),
                com.circlo.server.web.Ids.bytes(java.util.UUID.fromString(old)));
        sweep.sweep(Instant.now());
        String general = (String) lists(a).get(0).get("listId");
        assertThat(titles(a.list("GET", "/v1/todos/lists/" + general + "/completed", null).getBody())).containsExactly("Recent");
    }

    @Test
    @SuppressWarnings("unchecked")
    void myExportHasMyTodosAndDeletingMyAccountForgetsThem() {
        TestUser a = user("todo_export");
        add(a, body("title", "Pack", "notes", "Passport!", "dueDate", "2026-12-01"));
        Map<String, Object> export = a.call("GET", "/v1/me/export", null).getBody();
        assertThat((List<Map<String, Object>>) export.get("todos")).singleElement().satisfies(l -> {
            assertThat(l).containsEntry("name", "General");
            assertThat((List<Map<String, Object>>) l.get("todos")).singleElement()
                    .satisfies(t -> assertThat(t).containsEntry("title", "Pack").containsEntry("notes", "Passport!").containsEntry("dueDate", "2026-12-01"));
        });

        assertThat(a.call("DELETE", "/v1/account", Map.of("password", a.password)).getStatusCode().value()).isEqualTo(200);
        byte[] id = com.circlo.server.web.Ids.bytes(a.userId);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM todos WHERE user_id = ?", Integer.class, (Object) id)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM todo_lists WHERE user_id = ?", Integer.class, (Object) id)).isZero();
    }
}
