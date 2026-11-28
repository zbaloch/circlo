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
 * Todos (2.0): personal to-do lists, like pen and paper. A to-do is a title and a tick; its notes are a log of dated
 * entries. Only their owner can ever see or change them; General is made for everyone and can't be deleted;
 * completed ones are kept 30 days.
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
    void everyoneStartsWithGeneralWhereNewToDosGo() {
        TestUser a = user("todo_general");
        assertThat(lists(a)).singleElement().satisfies(l -> assertThat(l).containsEntry("name", "General").containsEntry("general", true));
        assertThat(todos(a)).isEmpty();

        Map<String, Object> t = add(a, body("title", "  Call mum  "));
        assertThat(t).containsEntry("title", "Call mum").containsEntry("listId", lists(a).get(0).get("listId")).containsEntry("noteCount", 0)
                .containsEntry("completedAt", null).doesNotContainKeys("dueDate", "repeat", "notes");
        assertThat(lists(a)).hasSize(1);
        assertThat(a.call("POST", "/v1/todos", body("title", "")).getStatusCode().value()).isEqualTo(400);
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

        String milk = (String) add(a, body("title", "Milk", "listId", groceries)).get("todoId");
        a.call("POST", "/v1/todos/" + milk + "/notes", Map.of("body", "Oat"));
        assertThat(a.call("DELETE", "/v1/todos/lists/" + general, null).getBody()).containsEntry("error", "general_list");
        assertThat(a.call("DELETE", "/v1/todos/lists/" + groceries, null).getStatusCode().value()).isEqualTo(204);
        assertThat(lists(a)).extracting(l -> l.get("name")).containsExactly("Work", "Inbox");
        assertThat(todos(a)).isEmpty();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM todo_notes", Integer.class)).isZero();

        assertThat(a.call("POST", "/v1/todos/lists", Map.of("name", "  ")).getStatusCode().value()).isEqualTo(400);
    }

    @Test
    void aToDoCanBeRenamedMovedAndDeleted() {
        TestUser a = user("todo_edit");
        String work = (String) a.call("POST", "/v1/todos/lists", Map.of("name", "Work")).getBody().get("listId");
        String id = (String) add(a, body("title", "Taxes")).get("todoId");
        assertThat(a.call("PUT", "/v1/todos/" + id, body("title", "File taxes", "listId", work)).getBody()).containsEntry("title", "File taxes")
                .containsEntry("listId", work);
        assertThat(a.call("PUT", "/v1/todos/" + id, body("title", "File the taxes")).getBody()).containsEntry("listId", work);
        assertThat(a.call("DELETE", "/v1/todos/" + id, null).getStatusCode().value()).isEqualTo(204);
        assertThat(todos(a)).isEmpty();
    }

    @Test
    @SuppressWarnings("unchecked")
    void notesAreALogOfDatedEntries() {
        TestUser a = user("todo_notes");
        String id = (String) add(a, body("title", "Plan the trip")).get("todoId");
        Instant before = Instant.now().minusSeconds(1);
        Map<String, Object> first = a.call("POST", "/v1/todos/" + id + "/notes", Map.of("body", "  Flights look cheaper on Tuesdays  ")).getBody();
        assertThat(first).containsEntry("body", "Flights look cheaper on Tuesdays");
        assertThat(Instant.parse((String) first.get("createdAt"))).isAfter(before);
        a.call("POST", "/v1/todos/" + id + "/notes", Map.of("body", "Booked: https://air.example/123"));

        // Oldest first, like a conversation; the list shows that it has notes.
        List<Map<String, Object>> notes = a.list("GET", "/v1/todos/" + id + "/notes", null).getBody();
        assertThat(notes).extracting(n -> n.get("body")).containsExactly("Flights look cheaper on Tuesdays", "Booked: https://air.example/123");
        assertThat(todos(a)).singleElement().satisfies(t -> assertThat(t).containsEntry("noteCount", 2));

        assertThat(a.call("DELETE", "/v1/todos/" + id + "/notes/" + first.get("noteId"), null).getStatusCode().value()).isEqualTo(204);
        assertThat(a.list("GET", "/v1/todos/" + id + "/notes", null).getBody()).hasSize(1);
        assertThat(a.call("POST", "/v1/todos/" + id + "/notes", Map.of("body", "   ")).getStatusCode().value()).isEqualTo(400);

        // Deleting the to-do takes its notes with it.
        a.call("DELETE", "/v1/todos/" + id, null);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM todo_notes", Integer.class)).isZero();
    }

    @Test
    void addingIsLimitedPerHourAndNotesAltogether() {
        TestUser a = user("todo_limits");
        String id = (String) add(a, body("title", "One")).get("todoId");
        // All my notes together are capped (so one account can't fill the disk).
        byte[] me = com.circlo.server.web.Ids.bytes(a.userId);
        byte[] todo = com.circlo.server.web.Ids.bytes(java.util.UUID.fromString(id));
        Timestamp now = Timestamp.from(Instant.now());
        jdbc.batchUpdate("INSERT INTO todo_notes (id, todo_id, user_id, body, created_at) VALUES (?, ?, ?, 'n', ?)",
                java.util.stream.IntStream.range(0, 20_000)
                        .mapToObj(i -> new Object[] {com.circlo.server.web.Ids.bytes(java.util.UUID.randomUUID()), todo, me, now}).toList());
        assertThat(a.call("POST", "/v1/todos/" + id + "/notes", Map.of("body", "one more")).getBody()).containsEntry("error", "too_many_notes");

        // Adding to-dos, notes and lists: 300 an hour (the refused note counted too).
        for (int i = 1; i <= 298; i++) {
            assertThat(a.call("POST", "/v1/todos", body("title", "T" + i)).getStatusCode().value()).as("add %d", i).isEqualTo(201);
        }
        ResponseEntity<Map<String, Object>> over = a.call("POST", "/v1/todos/lists", Map.of("name", "One too many"));
        assertThat(over.getStatusCode().value()).isEqualTo(429);
        assertThat(over.getBody()).containsEntry("error", "rate_limited");
        // Someone else isn't affected.
        assertThat(user("todo_limits_other").call("POST", "/v1/todos", body("title", "Fine")).getStatusCode().value()).isEqualTo(201);
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
    void tickingMovesItToCompletedAndUntickingBringsItBack() {
        TestUser a = user("todo_tick");
        String id = (String) add(a, body("title", "Buy cake")).get("todoId");
        assertThat(a.call("POST", "/v1/todos/" + id + "/complete", null).getBody()).containsEntry("todoId", id).doesNotContainEntry("completedAt", null);
        assertThat(todos(a)).isEmpty();

        String general = (String) lists(a).get(0).get("listId");
        assertThat(titles(a.list("GET", "/v1/todos/lists/" + general + "/completed", null).getBody())).containsExactly("Buy cake");
        String work = (String) a.call("POST", "/v1/todos/lists", Map.of("name", "Work")).getBody().get("listId");
        String report = (String) add(a, body("title", "Report", "listId", work)).get("todoId");
        a.call("POST", "/v1/todos/" + report + "/complete", null);
        assertThat(titles(a.list("GET", "/v1/todos/completed", null).getBody())).containsExactly("Report", "Buy cake");
        assertThat(user("todo_tick_other").list("GET", "/v1/todos/completed", null).getBody()).isEmpty();

        assertThat(a.call("POST", "/v1/todos/" + id + "/reopen", null).getBody()).containsEntry("completedAt", null);
        assertThat(titles(todos(a))).containsExactly("Buy cake");
        assertThat(a.list("GET", "/v1/todos/lists/" + general + "/completed", null).getBody()).isEmpty();
    }

    @Test
    void myTodosAndNotesAreMineAlone() {
        TestUser a = user("todo_mine");
        TestUser b = user("todo_theirs");
        String id = (String) add(a, body("title", "Secret plan")).get("todoId");
        String note = (String) a.call("POST", "/v1/todos/" + id + "/notes", Map.of("body", "Nobody else")).getBody().get("noteId");
        String list = (String) lists(a).get(0).get("listId");

        assertThat(todos(b)).isEmpty();
        for (String[] call : List.of(new String[] {"PUT", "/v1/todos/" + id}, new String[] {"DELETE", "/v1/todos/" + id},
                new String[] {"POST", "/v1/todos/" + id + "/complete"}, new String[] {"POST", "/v1/todos/" + id + "/reopen"},
                new String[] {"GET", "/v1/todos/" + id + "/notes"}, new String[] {"POST", "/v1/todos/" + id + "/notes"},
                new String[] {"DELETE", "/v1/todos/" + id + "/notes/" + note},
                new String[] {"PUT", "/v1/todos/lists/" + list}, new String[] {"DELETE", "/v1/todos/lists/" + list},
                new String[] {"GET", "/v1/todos/lists/" + list + "/completed"})) {
            Object payload = call[0].equals("PUT") ? body("title", "Mine now", "name", "Mine now") : call[1].endsWith("/notes") ? Map.of("body", "x") : null;
            assertThat(b.call(call[0], call[1], payload).getStatusCode().value()).as(call[0] + " " + call[1]).isEqualTo(404);
        }
        assertThat(b.call("POST", "/v1/todos", body("title", "Sneaky", "listId", list)).getStatusCode().value()).isEqualTo(404);
        assertThat(b.call("PUT", "/v1/todos/lists/" + list + "/order", Map.of("todoIds", List.of(id))).getStatusCode().value()).isEqualTo(404);
        assertThat(titles(todos(a))).containsExactly("Secret plan");
        assertThat(a.list("GET", "/v1/todos/" + id + "/notes", null).getBody()).hasSize(1);
        assertThat(call("GET", "/v1/todos", null, null).getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void completedTodosAreLetGoAfter30Days() {
        TestUser a = user("todo_sweep");
        String old = (String) add(a, body("title", "Old")).get("todoId");
        String recent = (String) add(a, body("title", "Recent")).get("todoId");
        a.call("POST", "/v1/todos/" + old + "/complete", null);
        a.call("POST", "/v1/todos/" + recent + "/complete", null);
        jdbc.update("UPDATE todos SET completed_at = ? WHERE id = ?", Timestamp.from(Instant.now().minus(Duration.ofDays(31))),
                com.circlo.server.web.Ids.bytes(java.util.UUID.fromString(old)));
        sweep.sweep(Instant.now());
        assertThat(titles(a.list("GET", "/v1/todos/completed", null).getBody())).containsExactly("Recent");
    }

    @Test
    @SuppressWarnings("unchecked")
    void myExportHasMyTodosAndNotesAndDeletingMyAccountForgetsThem() {
        TestUser a = user("todo_export");
        String id = (String) add(a, body("title", "Pack")).get("todoId");
        a.call("POST", "/v1/todos/" + id + "/notes", Map.of("body", "Passport!"));
        Map<String, Object> export = a.call("GET", "/v1/me/export", null).getBody();
        assertThat((List<Map<String, Object>>) export.get("todos")).singleElement().satisfies(l -> {
            assertThat(l).containsEntry("name", "General");
            assertThat((List<Map<String, Object>>) l.get("todos")).singleElement().satisfies(t -> {
                assertThat(t).containsEntry("title", "Pack");
                assertThat((List<Map<String, Object>>) t.get("notes")).singleElement().satisfies(n -> assertThat(n).containsEntry("body", "Passport!"));
            });
        });

        assertThat(a.call("DELETE", "/v1/account", Map.of("password", a.password)).getStatusCode().value()).isEqualTo(200);
        byte[] uid = com.circlo.server.web.Ids.bytes(a.userId);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM todos WHERE user_id = ?", Integer.class, (Object) uid)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM todo_lists WHERE user_id = ?", Integer.class, (Object) uid)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM todo_notes WHERE user_id = ?", Integer.class, (Object) uid)).isZero();
    }
}
