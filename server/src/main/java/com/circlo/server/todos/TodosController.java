package com.circlo.server.todos;

import com.circlo.server.auth.TokenService;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import com.circlo.server.web.RateLimiter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
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
 * Todos (2.0; owner decisions 2026-11-27/28): personal to-do lists, like pen and paper: a to-do is a title and a tick,
 * in my order within its list, and its notes are a log of dated entries (like comments). Every statement is scoped to
 * the caller's own user id, so someone else's list, to-do or note is simply not found (404). General is made on first
 * use. Nothing about to-dos is logged.
 */
@RestController
public class TodosController {

    static final int MAX_LISTS = 100;
    static final int MAX_OPEN = 5000;
    static final int MAX_NOTES = 500;
    /** All my notes together, so storage can't be filled by one account. */
    static final int MAX_NOTES_TOTAL = 20_000;
    /** Adding to-dos, notes and lists: far more than anyone writes by hand in an hour. */
    static final int WRITES_PER_HOUR = 300;
    private static final String TODO_COLUMNS =
            "t.id, t.list_id, t.title, t.completed_at, t.created_at, (SELECT COUNT(*) FROM todo_notes n WHERE n.todo_id = t.id) AS notes";

    private final JdbcTemplate jdbc;
    private final RateLimiter limiter;

    public TodosController(JdbcTemplate jdbc, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.limiter = limiter;
    }

    /** Adding things is limited per person per hour (429 rate_limited). */
    private void write(byte[] me) {
        if (!limiter.tryAcquire("todos-write", me, WRITES_PER_HOUR, 3_600_000)) {
            throw ApiException.rateLimited();
        }
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(TokenService.userOf(jwt));
    }

    public record TodoList(UUID listId, String name, boolean general) {}

    /** {@code noteCount}: how many notes it has (the list shows a mark when there are any). */
    public record Todo(UUID todoId, UUID listId, String title, int noteCount, Instant completedAt, Instant createdAt) {}

    /** A note on a to-do, with when it was added. */
    public record Note(UUID noteId, String body, Instant createdAt) {}

    public record Todos(List<TodoList> lists, List<Todo> todos) {}

    public record ListName(@NotNull @Size(max = 100) String name) {}

    public record ListOrder(@NotNull @Size(max = MAX_LISTS) List<UUID> listIds) {}

    public record TodoOrder(@NotNull @Size(max = MAX_OPEN) List<UUID> todoIds) {}

    /** A new to-do, or (PUT) its title and list. {@code listId} null means General (or, when editing, where it is). */
    public record TodoBody(@NotNull @Size(max = 2000) String title, UUID listId) {}

    public record NoteBody(@NotNull @Size(max = 20_000) String body) {}

    private static Todo todo(ResultSet rs) throws SQLException {
        Timestamp done = rs.getTimestamp("completed_at");
        return new Todo(Ids.uuid(rs.getBytes("id")), Ids.uuid(rs.getBytes("list_id")), rs.getString("title"), rs.getInt("notes"),
                done == null ? null : done.toInstant(), rs.getTimestamp("created_at").toInstant());
    }

    private static String name(String raw) {
        String n = raw.strip();
        if (n.isEmpty() || n.length() > 100) {
            throw ApiException.badRequest("invalid_name");
        }
        return n;
    }

    private static String title(String raw) {
        String t = raw.strip();
        if (t.isEmpty() || t.length() > 500) {
            throw ApiException.badRequest("invalid_title");
        }
        return t;
    }

    // --- lists ---

    /** General, made the first time it's needed (one per person: a unique key on user_id and general_key). */
    private UUID general(byte[] me) {
        List<byte[]> found = jdbc.queryForList("SELECT id FROM todo_lists WHERE user_id = ? AND is_general", byte[].class, (Object) me);
        if (!found.isEmpty()) {
            return Ids.uuid(found.get(0));
        }
        jdbc.update("INSERT IGNORE INTO todo_lists (id, user_id, name, is_general, general_key, position, created_at) VALUES (?, ?, 'General', TRUE, 1, 0, ?)",
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
        List<Todo> todos = jdbc.query("SELECT " + TODO_COLUMNS + " FROM todos t JOIN todo_lists l ON l.id = t.list_id"
                + " WHERE t.user_id = ? AND t.completed_at IS NULL ORDER BY l.position, l.created_at, t.position, t.created_at",
                (rs, i) -> todo(rs), (Object) me);
        return new Todos(lists, todos);
    }

    @PostMapping("/v1/todos/lists")
    @ResponseStatus(HttpStatus.CREATED)
    public TodoList addList(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ListName r) {
        byte[] me = me(jwt);
        String name = name(r.name());
        write(me);
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

    /** Deletes a list and its to-dos (and their notes); General stays (409 general_list). */
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
                + " FROM todos t WHERE t.list_id = ? AND t.user_id = ? AND t.completed_at IS NOT NULL ORDER BY t.completed_at DESC LIMIT 500",
                (rs, i) -> todo(rs), Ids.bytes(id), me);
    }

    /** All my completed to-dos, across my lists, newest first (the last 30 days'). */
    @GetMapping("/v1/todos/completed")
    public List<Todo> allCompleted(@AuthenticationPrincipal Jwt jwt) {
        return jdbc.query("SELECT " + TODO_COLUMNS
                + " FROM todos t WHERE t.user_id = ? AND t.completed_at IS NOT NULL ORDER BY t.completed_at DESC LIMIT 500",
                (rs, i) -> todo(rs), (Object) me(jwt));
    }

    // --- to-dos ---

    private Todo myTodo(byte[] me, UUID id) {
        return jdbc.query("SELECT " + TODO_COLUMNS + " FROM todos t WHERE t.id = ? AND t.user_id = ?", (rs, i) -> todo(rs), Ids.bytes(id), me)
                .stream().findFirst().orElseThrow(ApiException::notFound);
    }

    private int nextPosition(UUID list) {
        Integer max = jdbc.queryForObject("SELECT MAX(position) FROM todos WHERE list_id = ? AND completed_at IS NULL", Integer.class,
                (Object) Ids.bytes(list));
        return max == null ? 0 : max + 1;
    }

    /** Adds a to-do at the end of its list (General when no list is given). */
    @PostMapping("/v1/todos")
    @ResponseStatus(HttpStatus.CREATED)
    public Todo add(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody TodoBody r) {
        byte[] me = me(jwt);
        String title = title(r.title());
        UUID list = r.listId() == null ? general(me) : myList(me, r.listId()).listId();
        write(me);
        Integer open = jdbc.queryForObject("SELECT COUNT(*) FROM todos WHERE user_id = ? AND completed_at IS NULL", Integer.class, (Object) me);
        if (open != null && open >= MAX_OPEN) {
            throw ApiException.conflict("too_many_todos");
        }
        UUID id = Ids.newId();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO todos (id, user_id, list_id, title, position, created_at) VALUES (?, ?, ?, ?, ?, ?)", Ids.bytes(id), me,
                Ids.bytes(list), title, nextPosition(list), Timestamp.from(now));
        return new Todo(id, list, title, 0, null, now);
    }

    /** Its title and list; moving it to another list puts it at that list's end. */
    @PutMapping("/v1/todos/{id}")
    public Todo edit(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody TodoBody r) {
        byte[] me = me(jwt);
        Todo old = myTodo(me, id);
        String title = title(r.title());
        UUID list = r.listId() == null ? old.listId() : myList(me, r.listId()).listId();
        if (!list.equals(old.listId())) {
            jdbc.update("UPDATE todos SET list_id = ?, position = ? WHERE id = ? AND user_id = ?", Ids.bytes(list), nextPosition(list), Ids.bytes(id), me);
        }
        jdbc.update("UPDATE todos SET title = ? WHERE id = ? AND user_id = ?", title, Ids.bytes(id), me);
        return myTodo(me, id);
    }

    @DeleteMapping("/v1/todos/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        if (jdbc.update("DELETE FROM todos WHERE id = ? AND user_id = ?", Ids.bytes(id), me(jwt)) == 0) {
            throw ApiException.notFound();
        }
    }

    /** Ticks a to-do: it goes to Completed. */
    @PostMapping("/v1/todos/{id}/complete")
    public Todo complete(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        myTodo(me, id);
        jdbc.update("UPDATE todos SET completed_at = ? WHERE id = ? AND user_id = ? AND completed_at IS NULL", Timestamp.from(Instant.now()),
                Ids.bytes(id), me);
        return myTodo(me, id);
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

    // --- notes: a log under each to-do ---

    /** A to-do's notes, oldest first (newest at the bottom, like a conversation). */
    @GetMapping("/v1/todos/{id}/notes")
    public List<Note> notes(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        myTodo(me, id);
        return jdbc.query("SELECT id, body, created_at FROM todo_notes WHERE todo_id = ? AND user_id = ? ORDER BY created_at, id",
                (rs, i) -> new Note(Ids.uuid(rs.getBytes(1)), rs.getString(2), rs.getTimestamp(3).toInstant()), Ids.bytes(id), me);
    }

    /** Adds a note, stamped now. */
    @PostMapping("/v1/todos/{id}/notes")
    @ResponseStatus(HttpStatus.CREATED)
    public Note addNote(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody NoteBody r) {
        byte[] me = me(jwt);
        myTodo(me, id);
        String body = r.body().strip();
        if (body.isEmpty() || body.length() > 10_000) {
            throw ApiException.badRequest("invalid_note");
        }
        write(me);
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM todo_notes WHERE todo_id = ?", Integer.class, (Object) Ids.bytes(id));
        Integer total = jdbc.queryForObject("SELECT COUNT(*) FROM todo_notes WHERE user_id = ?", Integer.class, (Object) me);
        if (count != null && count >= MAX_NOTES || total != null && total >= MAX_NOTES_TOTAL) {
            throw ApiException.conflict("too_many_notes");
        }
        UUID noteId = Ids.newId();
        Instant now = Instant.now();
        jdbc.update("INSERT INTO todo_notes (id, todo_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)", Ids.bytes(noteId), Ids.bytes(id), me,
                body, Timestamp.from(now));
        return new Note(noteId, body, now);
    }

    @DeleteMapping("/v1/todos/{id}/notes/{noteId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteNote(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @PathVariable("noteId") UUID noteId) {
        if (jdbc.update("DELETE FROM todo_notes WHERE id = ? AND todo_id = ? AND user_id = ?", Ids.bytes(noteId), Ids.bytes(id), me(jwt)) == 0) {
            throw ApiException.notFound();
        }
    }
}
