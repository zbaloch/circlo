package com.circlo.server.desk;

import static com.circlo.server.desk.Desk.me;
import static com.circlo.server.desk.Desk.now;

import com.circlo.server.media.MediaSweeper;
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
 * Desk boards (owner decision 2026-11-15): "Home renovation", "Taxes 2026", each with a name, an optional description,
 * and its own to-dos, notes and files. Listed by name, with how many open to-dos, notes and files each has. For their
 * owner only.
 */
@RestController
public class DeskBoardsController {

    static final int MAX_BOARDS = 200;
    static final int MAX_NAME = 100;
    static final int MAX_DESCRIPTION = 10_000;

    private final JdbcTemplate jdbc;
    private final RateLimiter limiter;

    public DeskBoardsController(JdbcTemplate jdbc, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.limiter = limiter;
    }

    public record Board(UUID id, String name, String description, int todos, int notes, int files, Instant createdAt) {}

    public record BoardInput(@NotNull String name, String description) {}

    private static final String SELECT = """
            SELECT b.id, b.name, b.created_at, b.description,
                   (SELECT COUNT(*) FROM desk_todos t WHERE t.board_id = b.id AND t.done_at IS NULL),
                   (SELECT COUNT(*) FROM desk_notes n WHERE n.board_id = b.id),
                   (SELECT COUNT(*) FROM desk_files f WHERE f.board_id = b.id)
            FROM desk_boards b WHERE b.owner_id = ?""";

    private List<Board> query(String where, Object... args) {
        return jdbc.query(SELECT + where, (rs, i) -> new Board(Ids.uuid(rs.getBytes(1)), rs.getString(2), rs.getString(4), rs.getInt(5), rs.getInt(6),
                rs.getInt(7), rs.getTimestamp(3).toInstant()), args);
    }

    private Board load(byte[] me, UUID id) {
        List<Board> found = query(" AND b.id = ?", me, Ids.bytes(id));
        if (found.isEmpty()) {
            throw ApiException.notFound();
        }
        return found.get(0);
    }

    @GetMapping("/v1/desk/boards")
    public List<Board> boards(@AuthenticationPrincipal Jwt jwt) {
        return query(" ORDER BY b.name, b.created_at", (Object) me(jwt));
    }

    @PostMapping("/v1/desk/boards")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Board create(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody BoardInput r) {
        byte[] me = me(jwt);
        String name = Desk.line(r.name(), MAX_NAME, "invalid_name");
        String description = Desk.description(r.description(), MAX_DESCRIPTION);
        Desk.limitWrites(limiter, me);
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM desk_boards WHERE owner_id = ?", Integer.class, (Object) me);
        if (count != null && count >= MAX_BOARDS) {
            throw ApiException.conflict("too_many_boards");
        }
        UUID id = Ids.newId();
        var created = now();
        jdbc.update("INSERT INTO desk_boards (id, owner_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)", Ids.bytes(id), me, name,
                description, created);
        return new Board(id, name, description, 0, 0, 0, created.toInstant());
    }

    @GetMapping("/v1/desk/boards/{id}")
    public Board board(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        return load(me(jwt), id);
    }

    /** Replaces a board's name and description. */
    @PutMapping("/v1/desk/boards/{id}")
    public Board update(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody BoardInput r) {
        byte[] me = me(jwt);
        String name = Desk.line(r.name(), MAX_NAME, "invalid_name");
        String description = Desk.description(r.description(), MAX_DESCRIPTION);
        if (jdbc.update("UPDATE desk_boards SET name = ?, description = ? WHERE id = ? AND owner_id = ?", name, description, Ids.bytes(id), me) != 1) {
            throw ApiException.notFound();
        }
        return load(me, id);
    }

    /** Deletes a board with everything on it. Its files' uploads are let go, for the sweeper to remove from the bucket. */
    @DeleteMapping("/v1/desk/boards/{id}")
    @Transactional
    public Map<String, String> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        Desk.board(jdbc, me, id);
        MediaSweeper.release(jdbc, "desk_file_id IN (SELECT id FROM desk_files WHERE board_id = ? AND owner_id = ?)", Ids.bytes(id), me);
        jdbc.update("DELETE FROM desk_boards WHERE id = ? AND owner_id = ?", Ids.bytes(id), me);
        return Map.of("status", "deleted");
    }
}
