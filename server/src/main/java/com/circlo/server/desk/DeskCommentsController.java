package com.circlo.server.desk;

import static com.circlo.server.desk.Desk.me;
import static com.circlo.server.desk.Desk.now;

import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import com.circlo.server.web.RateLimiter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Comments on Desk to-dos, notes and files (owner decision 2026-11-15): the owner's own running log of how something
 * moved on, oldest first. Nobody else can read or write them; the Desk is never shared.
 */
@RestController
public class DeskCommentsController {

    static final int MAX_BODY = 5_000;

    /** What a comment can be on: its column in desk_comments and the table it points at. */
    enum On {
        todos("todo_id", "desk_todos"),
        notes("note_id", "desk_notes"),
        files("file_id", "desk_files");

        final String column;
        final String table;

        On(String column, String table) {
            this.column = column;
            this.table = table;
        }
    }

    private final JdbcTemplate jdbc;
    private final RateLimiter limiter;

    public DeskCommentsController(JdbcTemplate jdbc, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.limiter = limiter;
    }

    public record Comment(UUID id, String body, Instant createdAt) {}

    public record CommentInput(@NotNull String body) {}

    /** The comments on one of my things, oldest first (the caller has checked it's mine). */
    static List<Comment> list(JdbcTemplate jdbc, On on, UUID id) {
        return jdbc.query("SELECT id, body, created_at FROM desk_comments WHERE " + on.column + " = ? ORDER BY created_at, id",
                (rs, i) -> new Comment(Ids.uuid(rs.getBytes(1)), rs.getString(2), rs.getTimestamp(3).toInstant()), (Object) Ids.bytes(id));
    }

    /** A subquery counting the comments on the row aliased `alias`, for list views. */
    static String count(On on, String alias) {
        return "(SELECT COUNT(*) FROM desk_comments c WHERE c." + on.column + " = " + alias + ".id)";
    }

    private Comment add(Jwt jwt, On on, UUID id, CommentInput r) {
        byte[] me = me(jwt);
        String body = Desk.text(r.body(), MAX_BODY, true, "invalid_body");
        var at = now();
        if (jdbc.queryForList("SELECT 1 FROM " + on.table + " WHERE id = ? AND owner_id = ? FOR UPDATE", Integer.class, Ids.bytes(id), me).isEmpty()) {
            throw ApiException.notFound();
        }
        if (on == On.notes) {
            // A comment moves a note up its board, like an edit.
            jdbc.update("UPDATE desk_notes SET updated_at = ? WHERE id = ?", at, Ids.bytes(id));
        }
        Desk.limitWrites(limiter, me);
        UUID cid = Ids.newId();
        jdbc.update("INSERT INTO desk_comments (id, owner_id, " + on.column + ", body, created_at) VALUES (?, ?, ?, ?, ?)",
                Ids.bytes(cid), me, Ids.bytes(id), body, at);
        return new Comment(cid, body, at.toInstant());
    }

    @PostMapping("/v1/desk/todos/{id}/comments")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Comment onTodo(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody CommentInput r) {
        return add(jwt, On.todos, id, r);
    }

    @PostMapping("/v1/desk/notes/{id}/comments")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Comment onNote(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody CommentInput r) {
        return add(jwt, On.notes, id, r);
    }

    @PostMapping("/v1/desk/files/{id}/comments")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Comment onFile(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody CommentInput r) {
        return add(jwt, On.files, id, r);
    }

    @DeleteMapping("/v1/desk/comments/{id}")
    public Map<String, String> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        if (jdbc.update("DELETE FROM desk_comments WHERE id = ? AND owner_id = ?", Ids.bytes(id), me(jwt)) != 1) {
            throw ApiException.notFound();
        }
        return Map.of("status", "deleted");
    }
}
