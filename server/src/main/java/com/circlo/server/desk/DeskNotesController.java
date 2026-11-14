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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Desk notes (owner decision 2026-11-14, boards 2026-11-15): a board's notes, like messages with one reader: a title
 * and an optional description, with comments added over time. Pinned notes first, then the most recently changed or
 * commented on. For their owner only.
 */
@RestController
public class DeskNotesController {

    static final int MAX_TITLE = 200;
    static final int MAX_DESCRIPTION = 50_000;
    static final int SNIPPET = 140;

    private final JdbcTemplate jdbc;
    private final RateLimiter limiter;

    public DeskNotesController(JdbcTemplate jdbc, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.limiter = limiter;
    }

    public record NoteSummary(UUID id, UUID boardId, String title, String snippet, boolean pinned, int commentCount, Instant createdAt,
            Instant updatedAt) {}

    public record NoteView(UUID id, UUID boardId, String boardName, String title, String description, boolean pinned, int commentCount,
            Instant createdAt, Instant updatedAt) {}

    public record NoteDetail(NoteView note, List<Comment> comments) {}

    public record NoteInput(@NotNull UUID boardId, @NotNull String title, String description, Boolean pinned) {}

    /** The start of a description on one line, for the list. */
    static String snippet(String description) {
        String s = description.replaceAll("\\s+", " ").strip();
        return s.codePointCount(0, s.length()) <= SNIPPET ? s : s.substring(0, s.offsetByCodePoints(0, SNIPPET)).strip() + "…";
    }

    @GetMapping("/v1/desk/boards/{id}/notes")
    public List<NoteSummary> boardNotes(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        Desk.board(jdbc, me, id);
        return jdbc.query("SELECT n.id, n.title, n.description, n.pinned, n.created_at, n.updated_at, " + DeskCommentsController.count(On.notes, "n")
                + " FROM desk_notes n WHERE n.owner_id = ? AND n.board_id = ? ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC LIMIT 1000",
                (rs, i) -> new NoteSummary(Ids.uuid(rs.getBytes(1)), id, rs.getString(2), snippet(rs.getString(3)), rs.getBoolean(4), rs.getInt(7),
                        rs.getTimestamp(5).toInstant(), rs.getTimestamp(6).toInstant()),
                me, Ids.bytes(id));
    }

    private NoteView load(byte[] me, UUID id) {
        List<NoteView> found = jdbc.query("SELECT n.board_id, b.name, n.title, n.description, n.pinned, n.created_at, n.updated_at, "
                + DeskCommentsController.count(On.notes, "n") + " FROM desk_notes n JOIN desk_boards b ON b.id = n.board_id WHERE n.id = ? AND n.owner_id = ?",
                (rs, i) -> new NoteView(id, Ids.uuid(rs.getBytes(1)), rs.getString(2), rs.getString(3), rs.getString(4), rs.getBoolean(5), rs.getInt(8),
                        rs.getTimestamp(6).toInstant(), rs.getTimestamp(7).toInstant()),
                Ids.bytes(id), me);
        if (found.isEmpty()) {
            throw ApiException.notFound();
        }
        return found.get(0);
    }

    @PostMapping("/v1/desk/notes")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public NoteView create(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody NoteInput r) {
        byte[] me = me(jwt);
        String title = Desk.line(r.title(), MAX_TITLE, "invalid_title");
        String description = Desk.description(r.description(), MAX_DESCRIPTION);
        Desk.board(jdbc, me, r.boardId());
        Desk.limitWrites(limiter, me);
        UUID id = Ids.newId();
        var at = now();
        jdbc.update("INSERT INTO desk_notes (id, owner_id, board_id, title, description, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                Ids.bytes(id), me, Ids.bytes(r.boardId()), title, description, Boolean.TRUE.equals(r.pinned()), at, at);
        return load(me, id);
    }

    @GetMapping("/v1/desk/notes/{id}")
    public NoteDetail note(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        return new NoteDetail(load(me(jwt), id), DeskCommentsController.list(jdbc, On.notes, id));
    }

    /** Replaces the title, description and board; `pinned` left out keeps it as it was. */
    @PutMapping("/v1/desk/notes/{id}")
    @Transactional
    public NoteView update(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody NoteInput r) {
        byte[] me = me(jwt);
        load(me, id);
        String title = Desk.line(r.title(), MAX_TITLE, "invalid_title");
        String description = Desk.description(r.description(), MAX_DESCRIPTION);
        Desk.board(jdbc, me, r.boardId());
        jdbc.update("UPDATE desk_notes SET board_id = ?, title = ?, description = ?, pinned = COALESCE(?, pinned), updated_at = ? WHERE id = ? AND owner_id = ?",
                Ids.bytes(r.boardId()), title, description, r.pinned(), now(), Ids.bytes(id), me);
        return load(me, id);
    }

    @DeleteMapping("/v1/desk/notes/{id}")
    public Map<String, String> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        if (jdbc.update("DELETE FROM desk_notes WHERE id = ? AND owner_id = ?", Ids.bytes(id), me(jwt)) != 1) {
            throw ApiException.notFound();
        }
        return Map.of("status", "deleted");
    }
}
