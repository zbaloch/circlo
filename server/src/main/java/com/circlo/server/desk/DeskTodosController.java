package com.circlo.server.desk;

import static com.circlo.server.desk.Desk.me;
import static com.circlo.server.desk.Desk.now;

import com.circlo.server.desk.DeskCommentsController.Comment;
import com.circlo.server.desk.DeskCommentsController.On;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import com.circlo.server.web.RateLimiter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.Objects;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Desk to-dos (owner decision 2026-11-14, boards 2026-11-15): each board's to-dos, with a title, an optional
 * description, and optional due dates and repeats, for their owner only. Due dates are calendar days on the owner's
 * clock, so the app sends its own "today" where it matters.
 */
@RestController
public class DeskTodosController {

    static final int MAX_TITLE = 500;
    static final int MAX_DESCRIPTION = 10_000;
    static final int DONE_SHOWN = 30;

    private final JdbcTemplate jdbc;
    private final RateLimiter limiter;

    public DeskTodosController(JdbcTemplate jdbc, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.limiter = limiter;
    }

    public record Repeat(String kind, int every) {}

    public record TodoView(UUID id, UUID boardId, String boardName, String title, String description, String dueDate, Repeat repeat,
            Instant doneAt, int commentCount, Instant createdAt) {}

    public record TodoDetail(TodoView todo, List<TodoView> history, List<Comment> comments) {}

    public record BoardTodos(List<TodoView> open, List<TodoView> done) {}

    public record TodoInput(@NotNull UUID boardId, @NotNull String title, String description, String dueDate, Repeat repeat) {}

    public record Today(@NotNull String today) {}

    public record Done(TodoView todo, TodoView next) {}

    private static final String SELECT = "SELECT t.id, t.board_id, b.name, t.title, t.description, t.due_date, t.repeat_kind, t.repeat_every,"
            + " t.done_at, t.created_at, " + DeskCommentsController.count(On.todos, "t")
            + " FROM desk_todos t JOIN desk_boards b ON b.id = t.board_id";

    private static TodoView view(ResultSet rs) throws SQLException {
        Date due = rs.getDate(6);
        String kind = rs.getString(7);
        var done = rs.getTimestamp(9);
        return new TodoView(Ids.uuid(rs.getBytes(1)), Ids.uuid(rs.getBytes(2)), rs.getString(3), rs.getString(4), rs.getString(5),
                due == null ? null : due.toLocalDate().toString(), kind == null ? null : new Repeat(kind, rs.getInt(8)),
                done == null ? null : done.toInstant(), rs.getInt(11), rs.getTimestamp(10).toInstant());
    }

    private TodoView load(byte[] me, UUID id) {
        List<TodoView> found = jdbc.query(SELECT + " WHERE t.id = ? AND t.owner_id = ?", (rs, i) -> view(rs), Ids.bytes(id), me);
        if (found.isEmpty()) {
            throw ApiException.notFound();
        }
        return found.get(0);
    }

    /** A board's to-dos: the open ones oldest first, and the most recently done. */
    @GetMapping("/v1/desk/boards/{id}/todos")
    public BoardTodos boardTodos(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        Desk.board(jdbc, me, id);
        List<TodoView> open = jdbc.query(SELECT + " WHERE t.owner_id = ? AND t.board_id = ? AND t.done_at IS NULL ORDER BY t.created_at",
                (rs, i) -> view(rs), me, Ids.bytes(id));
        List<TodoView> done = jdbc.query(SELECT + " WHERE t.owner_id = ? AND t.board_id = ? AND t.done_at IS NOT NULL ORDER BY t.done_at DESC LIMIT "
                + DONE_SHOWN, (rs, i) -> view(rs), me, Ids.bytes(id));
        return new BoardTodos(open, done);
    }

    private static LocalDate date(String raw) {
        try {
            return LocalDate.parse(raw);
        } catch (DateTimeParseException e) {
            throw ApiException.badRequest("invalid_date");
        }
    }

    /** The app's today: a calendar day at most a day or so from the server's (time zones span about 26 hours). */
    private static LocalDate today(String raw) {
        LocalDate d = date(raw);
        LocalDate utc = LocalDate.now(ZoneOffset.UTC);
        if (d.isBefore(utc.minusDays(2)) || d.isAfter(utc.plusDays(2))) {
            throw ApiException.badRequest("invalid_date");
        }
        return d;
    }

    /** Checked input: title, description, due date and repeat. */
    private record Clean(String title, String description, LocalDate due, Repeat repeat) {}

    private static Clean clean(TodoInput r) {
        String title = Desk.text(r.title(), MAX_TITLE, true, "invalid_title");
        String description = Desk.description(r.description(), MAX_DESCRIPTION);
        LocalDate due = r.dueDate() == null || r.dueDate().isBlank() ? null : date(r.dueDate());
        Repeat repeat = r.repeat();
        if (repeat != null) {
            if (repeat.kind() == null || !Repeats.KINDS.contains(repeat.kind()) || repeat.every() < 1 || repeat.every() > 365) {
                throw ApiException.badRequest("invalid_repeat");
            }
            if (due == null && !repeat.kind().equals("after")) {
                throw ApiException.badRequest("repeat_needs_due_date");
            }
            if (repeat.kind().equals("weekdays")) {
                repeat = new Repeat("weekdays", 1);
            }
        }
        return new Clean(title, description, due, repeat);
    }

    @PostMapping("/v1/desk/todos")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public TodoView createTodo(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody TodoInput r) {
        byte[] me = me(jwt);
        Clean c = clean(r);
        Desk.board(jdbc, me, r.boardId());
        Desk.limitWrites(limiter, me);
        UUID id = Ids.newId();
        insert(me, id, r.boardId(), c.title(), c.description(), c.due(), c.repeat(), c.due(), null);
        return load(me, id);
    }

    private void insert(byte[] me, UUID id, UUID boardId, String title, String description, LocalDate due, Repeat repeat, LocalDate anchor,
            byte[] series) {
        jdbc.update("""
                INSERT INTO desk_todos (id, owner_id, board_id, title, description, due_date, repeat_kind, repeat_every, repeat_anchor, series_id,
                  created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                Ids.bytes(id), me, Ids.bytes(boardId), title, description, due == null ? null : Date.valueOf(due), repeat == null ? null : repeat.kind(),
                repeat == null ? 1 : repeat.every(), repeat == null || anchor == null ? null : Date.valueOf(anchor), series, now());
    }

    /**
     * A to-do with its comments, and the earlier ones of its series that were done (newest first), for a repeating
     * to-do's history.
     */
    @GetMapping("/v1/desk/todos/{id}")
    public TodoDetail todo(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        TodoView t = load(me, id);
        List<TodoView> history = jdbc.query(SELECT + " WHERE t.owner_id = ? AND t.id <> ? AND t.done_at IS NOT NULL"
                + " AND t.series_id = (SELECT s.series_id FROM desk_todos s WHERE s.id = ? AND s.owner_id = ?)"
                + " ORDER BY t.done_at DESC LIMIT 20", (rs, i) -> view(rs), me, Ids.bytes(id), Ids.bytes(id), me);
        return new TodoDetail(t, history, DeskCommentsController.list(jdbc, On.todos, id));
    }

    /**
     * Replaces a to-do's title, description, due date, repeat and board. A new due date or repeat restarts its schedule
     * from that date.
     */
    @PutMapping("/v1/desk/todos/{id}")
    @Transactional
    public TodoView updateTodo(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody TodoInput r) {
        byte[] me = me(jwt);
        TodoView before = load(me, id);
        Clean c = clean(r);
        Desk.board(jdbc, me, r.boardId());
        String due = c.due() == null ? null : c.due().toString();
        boolean restart = !Objects.equals(due, before.dueDate()) || !Objects.equals(c.repeat(), before.repeat());
        jdbc.update("""
                UPDATE desk_todos SET board_id = ?, title = ?, description = ?, due_date = ?, repeat_kind = ?, repeat_every = ?,
                  repeat_anchor = CASE WHEN ? THEN ? ELSE repeat_anchor END
                WHERE id = ? AND owner_id = ?""",
                Ids.bytes(r.boardId()), c.title(), c.description(), c.due() == null ? null : Date.valueOf(c.due()),
                c.repeat() == null ? null : c.repeat().kind(), c.repeat() == null ? 1 : c.repeat().every(),
                restart, c.due() == null || c.repeat() == null ? null : Date.valueOf(c.due()), Ids.bytes(id), me);
        return load(me, id);
    }

    @DeleteMapping("/v1/desk/todos/{id}")
    public Map<String, String> deleteTodo(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        if (jdbc.update("DELETE FROM desk_todos WHERE id = ? AND owner_id = ?", Ids.bytes(id), me(jwt)) != 1) {
            throw ApiException.notFound();
        }
        return Map.of("status", "deleted");
    }

    /**
     * Ticks a to-do off. A repeating one makes the next in its series straight away, due on its next date (counted from
     * `today`, the app's calendar day, for "after" repeats). Ticking off one that's already done changes nothing.
     */
    @PostMapping("/v1/desk/todos/{id}/done")
    @Transactional
    public Done done(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody Today r) {
        byte[] me = me(jwt);
        List<Object[]> rows = jdbc.query("""
                SELECT board_id, title, description, due_date, repeat_kind, repeat_every, repeat_anchor, series_id, done_at
                FROM desk_todos WHERE id = ? AND owner_id = ? FOR UPDATE""",
                (rs, i) -> new Object[] {rs.getBytes(1), rs.getString(2), rs.getString(3), rs.getDate(4), rs.getString(5), rs.getInt(6),
                        rs.getDate(7), rs.getBytes(8), rs.getTimestamp(9)},
                Ids.bytes(id), me);
        if (rows.isEmpty()) {
            throw ApiException.notFound();
        }
        LocalDate today = today(r.today());
        Object[] t = rows.get(0);
        if (t[8] != null) {
            return new Done(load(me, id), null);
        }
        String kind = (String) t[4];
        UUID nextId = null;
        if (kind != null) {
            LocalDate due = t[3] == null ? null : ((Date) t[3]).toLocalDate();
            LocalDate anchor = t[6] == null ? null : ((Date) t[6]).toLocalDate();
            int every = (Integer) t[5];
            byte[] series = t[7] != null ? (byte[]) t[7] : Ids.bytes(id);
            nextId = Ids.newId();
            insert(me, nextId, Ids.uuid((byte[]) t[0]), (String) t[1], (String) t[2], Repeats.next(kind, every, anchor, due, today),
                    new Repeat(kind, every), anchor != null ? anchor : due, series);
            jdbc.update("UPDATE desk_todos SET series_id = ? WHERE id = ?", series, Ids.bytes(id));
        }
        jdbc.update("UPDATE desk_todos SET done_at = ?, next_id = ? WHERE id = ? AND owner_id = ?", now(), Desk.bytes(nextId), Ids.bytes(id), me);
        return new Done(load(me, id), nextId == null ? null : load(me, nextId));
    }

    /** Un-ticks a to-do. The next one a repeat made goes again, unless it has been done itself. */
    @DeleteMapping("/v1/desk/todos/{id}/done")
    @Transactional
    public TodoView undone(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        List<byte[]> next = jdbc.query("SELECT next_id FROM desk_todos WHERE id = ? AND owner_id = ? FOR UPDATE", (rs, i) -> rs.getBytes(1),
                Ids.bytes(id), me);
        if (next.isEmpty()) {
            throw ApiException.notFound();
        }
        if (next.get(0) != null) {
            jdbc.update("DELETE FROM desk_todos WHERE id = ? AND owner_id = ? AND done_at IS NULL", next.get(0), me);
        }
        jdbc.update("UPDATE desk_todos SET done_at = NULL, next_id = NULL WHERE id = ? AND owner_id = ?", Ids.bytes(id), me);
        return load(me, id);
    }

    /** Open to-dos due on or before `date` (the app's today) on all my boards, earliest first. */
    @GetMapping("/v1/desk/today")
    public List<TodoView> today(@AuthenticationPrincipal Jwt jwt, @RequestParam("date") String date) {
        LocalDate d = date(date);
        return jdbc.query(SELECT + " WHERE t.owner_id = ? AND t.done_at IS NULL AND t.due_date IS NOT NULL AND t.due_date <= ?"
                + " ORDER BY t.due_date, t.created_at LIMIT 200", (rs, i) -> view(rs), me(jwt), Date.valueOf(d));
    }
}
