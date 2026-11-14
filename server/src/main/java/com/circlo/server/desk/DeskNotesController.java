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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Desk notes (owner decision 2026-11-14): a title and a body, with follow-ups added over time, like a message board
 * with one reader. Pinned notes first, then the most recently changed. For their owner only.
 */
@RestController
public class DeskNotesController {

    static final int MAX_TITLE = 200;
    static final int MAX_BODY = 50_000;
    static final int MAX_FOLLOWUP = 5_000;
    static final int SNIPPET = 140;

    private final JdbcTemplate jdbc;
    private final RateLimiter limiter;

    public DeskNotesController(JdbcTemplate jdbc, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.limiter = limiter;
    }

    public record NoteSummary(UUID id, String title, String snippet, boolean pinned, int followups, Instant createdAt, Instant updatedAt) {}

    public record Followup(UUID id, String body, Instant createdAt) {}

    public record NoteView(UUID id, String title, String body, boolean pinned, Instant createdAt, Instant updatedAt, List<Followup> followups) {}

    public record NoteInput(@NotNull String title, @NotNull String body, Boolean pinned) {}

    public record FollowupInput(@NotNull String body) {}

    /** The start of a body on one line, for the list. */
    static String snippet(String body) {
        String s = body.replaceAll("\\s+", " ").strip();
        return s.codePointCount(0, s.length()) <= SNIPPET ? s : s.substring(0, s.offsetByCodePoints(0, SNIPPET)).strip() + "…";
    }

    @GetMapping("/v1/desk/notes")
    public List<NoteSummary> notes(@AuthenticationPrincipal Jwt jwt) {
        return jdbc.query("""
                SELECT n.id, n.title, n.body, n.pinned, n.created_at, n.updated_at,
                       (SELECT COUNT(*) FROM desk_note_followups f WHERE f.note_id = n.id)
                FROM desk_notes n WHERE n.owner_id = ? ORDER BY n.pinned DESC, n.updated_at DESC, n.id DESC LIMIT 1000""",
                (rs, i) -> new NoteSummary(Ids.uuid(rs.getBytes(1)), rs.getString(2), snippet(rs.getString(3)), rs.getBoolean(4), rs.getInt(7),
                        rs.getTimestamp(5).toInstant(), rs.getTimestamp(6).toInstant()),
                (Object) me(jwt));
    }

    private record Clean(String title, String body) {}

    private static Clean clean(NoteInput r) {
        String title = Desk.text(r.title(), MAX_TITLE, false, "invalid_title");
        if (title.contains("\n") || title.contains("\r")) {
            throw ApiException.badRequest("invalid_title");
        }
        String body = r.body() == null ? "" : r.body().stripTrailing();
        if (body.codePointCount(0, body.length()) > MAX_BODY) {
            throw ApiException.badRequest("invalid_body");
        }
        if (title.isEmpty() && body.isBlank()) {
            throw ApiException.badRequest("empty_note");
        }
        return new Clean(title, body.isBlank() ? "" : body);
    }

    @PostMapping("/v1/desk/notes")
    @ResponseStatus(HttpStatus.CREATED)
    public NoteView create(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody NoteInput r) {
        byte[] me = me(jwt);
        Clean c = clean(r);
        Desk.limitWrites(limiter, me);
        UUID id = Ids.newId();
        var at = now();
        jdbc.update("INSERT INTO desk_notes (id, owner_id, title, body, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                Ids.bytes(id), me, c.title(), c.body(), Boolean.TRUE.equals(r.pinned()), at, at);
        return load(me, id);
    }

    private NoteView load(byte[] me, UUID id) {
        List<NoteView> found = jdbc.query("SELECT title, body, pinned, created_at, updated_at FROM desk_notes WHERE id = ? AND owner_id = ?",
                (rs, i) -> new NoteView(id, rs.getString(1), rs.getString(2), rs.getBoolean(3), rs.getTimestamp(4).toInstant(),
                        rs.getTimestamp(5).toInstant(), jdbc.query(
                                "SELECT id, body, created_at FROM desk_note_followups WHERE note_id = ? ORDER BY created_at, id",
                                (f, j) -> new Followup(Ids.uuid(f.getBytes(1)), f.getString(2), f.getTimestamp(3).toInstant()), (Object) Ids.bytes(id))),
                Ids.bytes(id), me);
        if (found.isEmpty()) {
            throw ApiException.notFound();
        }
        return found.get(0);
    }

    @GetMapping("/v1/desk/notes/{id}")
    public NoteView note(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        return load(me(jwt), id);
    }

    /** Replaces the title and body; `pinned` left out keeps it as it was. */
    @PutMapping("/v1/desk/notes/{id}")
    public NoteView update(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody NoteInput r) {
        byte[] me = me(jwt);
        Clean c = clean(r);
        if (jdbc.update("UPDATE desk_notes SET title = ?, body = ?, pinned = COALESCE(?, pinned), updated_at = ? WHERE id = ? AND owner_id = ?",
                c.title(), c.body(), r.pinned(), now(), Ids.bytes(id), me) != 1) {
            throw ApiException.notFound();
        }
        return load(me, id);
    }

    @DeleteMapping("/v1/desk/notes/{id}")
    public Map<String, String> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        if (jdbc.update("DELETE FROM desk_notes WHERE id = ? AND owner_id = ?", Ids.bytes(id), me(jwt)) != 1) {
            throw ApiException.notFound();
        }
        return Map.of("status", "deleted");
    }

    /** Adds a follow-up at the end of a note's log and moves the note up the list. */
    @PostMapping("/v1/desk/notes/{id}/followups")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Followup addFollowup(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody FollowupInput r) {
        byte[] me = me(jwt);
        String body = Desk.text(r.body(), MAX_FOLLOWUP, true, "invalid_body");
        var at = now();
        if (jdbc.update("UPDATE desk_notes SET updated_at = ? WHERE id = ? AND owner_id = ?", at, Ids.bytes(id), me) != 1) {
            throw ApiException.notFound();
        }
        Desk.limitWrites(limiter, me);
        UUID fid = Ids.newId();
        jdbc.update("INSERT INTO desk_note_followups (id, note_id, owner_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
                Ids.bytes(fid), Ids.bytes(id), me, body, at);
        return new Followup(fid, body, at.toInstant());
    }

    @DeleteMapping("/v1/desk/notes/{id}/followups/{followupId}")
    public Map<String, String> deleteFollowup(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id,
            @PathVariable("followupId") UUID followupId) {
        if (jdbc.update("DELETE FROM desk_note_followups WHERE id = ? AND note_id = ? AND owner_id = ?", Ids.bytes(followupId), Ids.bytes(id),
                me(jwt)) != 1) {
            throw ApiException.notFound();
        }
        return Map.of("status", "deleted");
    }
}
