package com.circlo.server.todos;

import com.circlo.server.auth.TokenService;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Todos (2.0; owner decision 2026-11-27): personal to-do lists. Every statement here is scoped to the caller's own
 * user id, so someone else's list or to-do is simply not found (404). General is made on first use. Nothing about
 * to-dos is logged.
 */
@RestController
public class TodosController {

    static final int MAX_LISTS = 100;
    static final int MAX_OPEN = 5000;
    private static final LocalDate EARLIEST = LocalDate.of(2000, 1, 1);
    private static final LocalDate LATEST = LocalDate.of(2999, 12, 31);
    private static final String TODO_COLUMNS = "id, list_id, title, notes, due_date, repeat_rule, completed_at, created_at";

    private final JdbcTemplate jdbc;

    public TodosController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(TokenService.userOf(jwt));
    }

    public record TodoList(UUID listId, String name, boolean general) {}

    /** {@code dueDate}: a calendar date ("2026-11-28"); {@code repeat}: daily, weekly or monthly, from that date. */
    public record Todo(UUID todoId, UUID listId, String title, String notes, LocalDate dueDate, String repeat, Instant completedAt,
            Instant createdAt) {}

    public record Todos(List<TodoList> lists, List<Todo> todos) {}

    public record ListName(@NotNull @Size(max = 100) String name) {}

    public record ListOrder(@NotNull @Size(max = MAX_LISTS) List<UUID> listIds) {}

    public record TodoOrder(@NotNull @Size(max = MAX_OPEN) List<UUID> todoIds) {}

    /** A new to-do, or (PUT) the whole of one: what's left out is cleared. {@code listId} null means General. */
    public record TodoBody(@NotNull @Size(max = 2000) String title, @Size(max = 10_000) String notes, LocalDate dueDate,
            @Pattern(regexp = "daily|weekly|monthly") String repeat, UUID listId) {}

    /** {@code today}: the phone's date, so a repeat's next date follows the calendar I live by. */
    public record Complete(@NotNull LocalDate today) {}

    public record Completed(Todo completed, Todo next) {}

    private static Todo todo(ResultSet rs) throws SQLException {
        Date due = rs.getDate("due_date");
        Timestamp done = rs.getTimestamp("completed_at");
        return new Todo(Ids.uuid(rs.getBytes("id")), Ids.uuid(rs.getBytes("list_id")), rs.getString("title"), rs.getString("notes"),
                due == null ? null : due.toLocalDate(), rs.getString("repeat_rule"), done == null ? null : done.toInstant(),
                rs.getTimestamp("created_at").toInstant());
    }

    private static String name(String raw) {
        String n = raw.strip();
        if (n.isEmpty() || n.length() > 100) {
            throw ApiException.badRequest("invalid_name");
        }
        return n;
    }

    // --- lists ---

    /** General, made the first time it's needed (one per person: a unique key on general_of). */
    private UUID general(byte[] me) {
        List<byte[]> found = jdbc.queryForList("SELECT id FROM todo_lists WHERE user_id = ? AND is_general", byte[].class, (Object) me);
        if (!found.isEmpty()) {
            return Ids.uuid(found.get(0));
        }
        jdbc.update("INSERT IGNORE INTO todo_lists (id, user_id, name, is_general, position, created_at) VALUES (?, ?, 'General', TRUE, 0, ?)",
                Ids.bytes(Ids.newId()), me, Timestamp.from(Instant.now()));
        return Ids.uuid(jdbc.queryForObject("SELECT id FROM todo_lists WHERE user_id = ? AND is_general", byte[].class, (Object) me));
    }

    private List<TodoList> lists(byte[] me) {
        general(me);
        return jdbc.query("SELECT id, name, is_general FROM todo_lists WHERE user_id = ? ORDER BY position, created_at",
                (rs, i) -> new TodoList(Ids.uuid(rs.getBytes(1)), rs.getString(2), rs.getBoolean(3)), (Object) me);
    }

    /** The list, if it's mine (404 otherwise). */
    private TodoList myList(byte[] me, UUID id) {
        return jdbc.query("SELECT id, name, is_general FROM todo_lists WHERE id = ? AND user_id = ?",
                (rs, i) -> new TodoList(Ids.uuid(rs.getBytes(1)), rs.getString(2), rs.getBoolean(3)), Ids.bytes(id), me)
                .stream().findFirst().orElseThrow(ApiException::notFound);
    }

    /** My lists and my open to-dos (lists in my order; to-dos by list, then my order within it). */
    @GetMapping("/v1/todos")
    public Todos all(@AuthenticationPrincipal Jwt jwt) {
        byte[] me = me(jwt);
        List<TodoList> lists = lists(me);
        List<Todo> todos = jdbc.query("""
                SELECT t.id, t.list_id, t.title, t.notes, t.due_date, t.repeat_rule, t.completed_at, t.created_at
                FROM todos t JOIN todo_lists l ON l.id = t.list_id
                WHERE t.user_id = ? AND t.completed_at IS NULL ORDER BY l.position, l.created_at, t.position, t.created_at""",
                (rs, i) -> todo(rs), (Object) me);
        return new Todos(lists, todos);
    }

    @PostMapping("/v1/todos/lists")
    @ResponseStatus(HttpStatus.CREATED)
    public TodoList addList(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ListName r) {
        byte[] me = me(jwt);
        String name = name(r.name());
        general(me);
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM todo_lists WHERE user_id = ?", Integer.class, (Object) me);
        if (count != null && count >= MAX_LISTS) {
            throw ApiException.conflict("too_many_lists");
        }
        UUID id = Ids.newId();
        jdbc.update("""
                INSERT INTO todo_lists (id, user_id, name, position, created_at)
                SELECT ?, ?, ?, COALESCE(MAX(position), 0) + 1, ? FROM todo_lists WHERE user_id = ?""",
                Ids.bytes(id), me, name, Timestamp.from(Instant.now()), me);
        return new TodoList(id, name, false);
    }

    @PutMapping("/v1/todos/lists/{id}")
    public TodoList renameList(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody ListName r) {
        byte[] me = me(jwt);
        TodoList list = myList(me, id);
        String name = name(r.name());
        jdbc.update("UPDATE todo_lists SET name = ? WHERE id = ? AND user_id = ?", name, Ids.bytes(id), me);
        return new TodoList(id, name, list.general());
    }

    /** Deletes a list and its to-dos; General stays (409 general_list). */
    @DeleteMapping("/v1/todos/lists/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteList(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        if (myList(me, id).general()) {
            throw ApiException.conflict("general_list");
        }
        jdbc.update("DELETE FROM todo_lists WHERE id = ? AND user_id = ?", Ids.bytes(id), me);
    }

    /** My lists in this order (ones left out keep their place after these). */
    @PutMapping("/v1/todos/lists/order")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void orderLists(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ListOrder r) {
        byte[] me = me(jwt);
        jdbc.update("UPDATE todo_lists SET position = position + ? WHERE user_id = ?", MAX_LISTS + 1, me);
        for (int i = 0; i < r.listIds().size(); i++) {
            jdbc.update("UPDATE todo_lists SET position = ? WHERE id = ? AND user_id = ?", i, Ids.bytes(r.listIds().get(i)), me);
        }
    }

    /** My open to-dos in this list in this order. */
    @PutMapping("/v1/todos/lists/{id}/order")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Transactional
    public void orderTodos(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody TodoOrder r) {
        byte[] me = me(jwt);
        myList(me, id);
        jdbc.update("UPDATE todos SET position = position + ? WHERE list_id = ? AND user_id = ? AND completed_at IS NULL", MAX_OPEN + 1,
                Ids.bytes(id), me);
        for (int i = 0; i < r.todoIds().size(); i++) {
            jdbc.update("UPDATE todos SET position = ? WHERE id = ? AND list_id = ? AND user_id = ?", i, Ids.bytes(r.todoIds().get(i)), Ids.bytes(id), me);
        }
    }

    /** A list's completed to-dos, newest first (the last 30 days'). */
    @GetMapping("/v1/todos/lists/{id}/completed")
    public List<Todo> completed(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        myList(me, id);
        return jdbc.query("SELECT " + TODO_COLUMNS
                + " FROM todos WHERE list_id = ? AND user_id = ? AND completed_at IS NOT NULL ORDER BY completed_at DESC LIMIT 500",
                (rs, i) -> todo(rs), Ids.bytes(id), me);
    }

    // --- to-dos ---

    private Todo myTodo(byte[] me, UUID id) {
        return jdbc.query("SELECT " + TODO_COLUMNS + " FROM todos WHERE id = ? AND user_id = ?", (rs, i) -> todo(rs), Ids.bytes(id), me)
                .stream().findFirst().orElseThrow(ApiException::notFound);
    }

    /** Title, notes, date and repeat, checked and tidied. */
    private record Fields(String title, String notes, LocalDate due, String repeat) {}

    private static Fields fields(TodoBody r) {
        String title = r.title().strip();
        if (title.isEmpty() || title.length() > 500) {
            throw ApiException.badRequest("invalid_title");
        }
        String notes = r.notes() == null || r.notes().isBlank() ? null : r.notes().stripTrailing();
        LocalDate due = r.dueDate();
        if (due != null && (due.isBefore(EARLIEST) || due.isAfter(LATEST))) {
            throw ApiException.badRequest("invalid_date");
        }
        if (r.repeat() != null && due == null) {
            throw ApiException.badRequest("repeat_needs_date");
        }
        return new Fields(title, notes, due, r.repeat());
    }

    private int nextPosition(UUID list) {
        Integer max = jdbc.queryForObject("SELECT MAX(position) FROM todos WHERE list_id = ? AND completed_at IS NULL", Integer.class,
                (Object) Ids.bytes(list));
        return max == null ? 0 : max + 1;
    }

    /** A monthly repeat's day of the month: the date's own, unless it's carried on from earlier ones. */
    private static Integer anchor(Fields f, Integer carried) {
        if (!"monthly".equals(f.repeat()) || f.due() == null) {
            return null;
        }
        return carried != null ? carried : f.due().getDayOfMonth();
    }

    private Todo insert(byte[] me, UUID list, Fields f, int position, Integer day) {
        UUID id = Ids.newId();
        Instant now = Instant.now();
        jdbc.update("""
                INSERT INTO todos (id, user_id, list_id, title, notes, due_date, repeat_rule, repeat_day, position, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                Ids.bytes(id), me, Ids.bytes(list), f.title(), f.notes(), f.due() == null ? null : Date.valueOf(f.due()), f.repeat(), anchor(f, day),
                position, Timestamp.from(now));
        return new Todo(id, list, f.title(), f.notes(), f.due(), f.repeat(), null, now);
    }

    @PostMapping("/v1/todos")
    @ResponseStatus(HttpStatus.CREATED)
    public Todo add(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody TodoBody r) {
        byte[] me = me(jwt);
        Fields f = fields(r);
        UUID list = r.listId() == null ? general(me) : myList(me, r.listId()).listId();
        Integer open = jdbc.queryForObject("SELECT COUNT(*) FROM todos WHERE user_id = ? AND completed_at IS NULL", Integer.class, (Object) me);
        if (open != null && open >= MAX_OPEN) {
            throw ApiException.conflict("too_many_todos");
        }
        return insert(me, list, f, nextPosition(list), null);
    }

    /** The whole to-do as it should be now; moving it to another list puts it at that list's end. */
    @PutMapping("/v1/todos/{id}")
    public Todo edit(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody TodoBody r) {
        byte[] me = me(jwt);
        Todo old = myTodo(me, id);
        Fields f = fields(r);
        UUID list = r.listId() == null ? old.listId() : myList(me, r.listId()).listId();
        if (!list.equals(old.listId())) {
            jdbc.update("UPDATE todos SET list_id = ?, position = ? WHERE id = ? AND user_id = ?", Ids.bytes(list), nextPosition(list), Ids.bytes(id), me);
        }
        // Saved with the same date and repeat: a monthly one keeps the day it started on.
        Integer kept = java.util.Objects.equals(f.due(), old.dueDate()) && java.util.Objects.equals(f.repeat(), old.repeat())
                ? jdbc.queryForObject("SELECT repeat_day FROM todos WHERE id = ?", Integer.class, (Object) Ids.bytes(id)) : null;
        jdbc.update("UPDATE todos SET title = ?, notes = ?, due_date = ?, repeat_rule = ?, repeat_day = ? WHERE id = ? AND user_id = ?", f.title(),
                f.notes(), f.due() == null ? null : Date.valueOf(f.due()), f.repeat(), anchor(f, kept), Ids.bytes(id), me);
        return myTodo(me, id);
    }

    @DeleteMapping("/v1/todos/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        if (jdbc.update("DELETE FROM todos WHERE id = ? AND user_id = ?", Ids.bytes(id), me(jwt)) == 0) {
            throw ApiException.notFound();
        }
    }

    /**
     * Ticks a to-do. A repeating one becomes a one-off in Completed, and its next one (same title, notes, list and
     * place, the next date after {@code today}) is returned as {@code next}.
     */
    @PostMapping("/v1/todos/{id}/complete")
    @Transactional
    public Completed complete(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody Complete r) {
        byte[] me = me(jwt);
        Todo t = myTodo(me, id);
        if (t.completedAt() != null) {
            return new Completed(t, null);
        }
        // The phone's date, unless it's far from the server's (a wrong clock): then the server's.
        LocalDate utc = LocalDate.now(ZoneOffset.UTC);
        LocalDate today = Math.abs(r.today().toEpochDay() - utc.toEpochDay()) <= 2 ? r.today() : utc;
        Map<String, Object> row = jdbc.queryForMap("SELECT position, repeat_day FROM todos WHERE id = ?", (Object) Ids.bytes(id));
        Integer day = row.get("repeat_day") == null ? null : ((Number) row.get("repeat_day")).intValue();
        jdbc.update("UPDATE todos SET completed_at = ?, repeat_rule = NULL, repeat_day = NULL WHERE id = ? AND user_id = ?",
                Timestamp.from(Instant.now()), Ids.bytes(id), me);
        Todo next = null;
        if (t.repeat() != null && t.dueDate() != null) {
            next = insert(me, t.listId(), new Fields(t.title(), t.notes(), Repeat.next(t.dueDate(), t.repeat(), day, today), t.repeat()),
                    ((Number) row.get("position")).intValue(), day);
        }
        return new Completed(myTodo(me, id), next);
    }

    /** Unticks a to-do; it goes back to the end of its list. */
    @PostMapping("/v1/todos/{id}/reopen")
    public Todo reopen(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        Todo t = myTodo(me, id);
        if (t.completedAt() != null) {
            jdbc.update("UPDATE todos SET completed_at = NULL, position = ? WHERE id = ? AND user_id = ?", nextPosition(t.listId()), Ids.bytes(id), me);
        }
        return myTodo(me, id);
    }
}
