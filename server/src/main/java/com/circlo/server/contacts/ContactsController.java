package com.circlo.server.contacts;

import com.circlo.server.auth.TokenService;
import com.circlo.server.social.People;
import com.circlo.server.social.People.Person;
import com.circlo.server.web.ApiException;
import com.circlo.server.web.Ids;
import com.circlo.server.web.RateLimiter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.Year;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
 * People, my personal CRM (owner decisions 2026-11-28; shown in the People tab): my private entries about the people in my life, on Circlo
 * or not, with days to remember, a catch-up rhythm and a dated log of notes. Everyone I'm connected to is listed
 * without my adding them; writing about one makes an entry linked to them. Every statement is scoped to the caller's
 * own user id, so someone else's entry or note is simply not found (404), and a linked person's name and photo are
 * shown only while we're connected. Reminders are scheduled by the app on the phone, so the server keeps no times or
 * time zones. Nothing about entries is logged.
 */
@RestController
public class ContactsController {

    static final int MAX_CONTACTS = 5000;
    static final int MAX_NOTES = 500;
    static final int MAX_NOTES_TOTAL = 20_000;
    static final int MAX_DATES = 20;
    static final int WRITES_PER_HOUR = 300;
    /** The rhythms the app offers: every week, 2 weeks, month, 3 months, 6 months, year. */
    static final Set<Integer> RHYTHMS = Set.of(7, 14, 30, 90, 180, 365);
    private static final String COLUMNS = """
            c.id, c.linked_user_id, c.name, c.keep_days, c.keep_since,
            (SELECT COUNT(*) FROM contact_notes n WHERE n.contact_id = c.id) AS notes,
            (SELECT MAX(n.noted_at) FROM contact_notes n WHERE n.contact_id = c.id AND n.caught_up) AS caught_up""";

    private final JdbcTemplate jdbc;
    private final People people;
    private final RateLimiter limiter;

    public ContactsController(JdbcTemplate jdbc, People people, RateLimiter limiter) {
        this.jdbc = jdbc;
        this.people = people;
        this.limiter = limiter;
    }

    private void write(byte[] me) {
        if (!limiter.tryAcquire("contacts-write", me, WRITES_PER_HOUR, 3_600_000)) {
            throw ApiException.rateLimited();
        }
    }

    private static byte[] me(Jwt jwt) {
        return Ids.bytes(TokenService.userOf(jwt));
    }

    private static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }

    /** A day to remember: month and day, and the year when it's known. */
    public record DateEntry(@NotNull @Size(max = 40) String label, int month, int day, Integer year) {}

    /**
     * One person. {@code contactId} is null for a connection I haven't written about; {@code person} (name, username,
     * photo) is there only while they're my connection. {@code keepSince} is when the rhythm started, and
     * {@code lastCaughtUp} the latest catch-up in the log: the app works out who's due from them.
     */
    public record Entry(UUID contactId, String name, Person person, List<DateEntry> dates, Integer keepInTouchDays, Instant keepSince,
            Instant lastCaughtUp, int noteCount) {}

    public record Everyone(List<Entry> people) {}

    /** A new entry: a name, and the connection it's about (if it's about one). */
    public record NewEntry(@NotNull @Size(max = 400) String name, UUID userId) {}

    /** The whole entry: its name, rhythm (null for none) and dates (replacing the ones it had). */
    public record EntryBody(@NotNull @Size(max = 400) String name, Integer keepInTouchDays, @Size(max = MAX_DATES) List<@Valid DateEntry> dates) {}

    public record Link(@NotNull UUID userId) {}

    /** A note, or a catch-up ({@code caughtUp}; its words are optional, and {@code at} can date it earlier). */
    public record NoteBody(@Size(max = 20_000) String body, Boolean caughtUp, LocalDate at) {}

    public record Note(UUID noteId, String body, boolean caughtUp, Instant at) {}

    private record Row(UUID id, UUID linked, String name, Integer keepDays, Instant keepSince, Instant caughtUp, int notes) {}

    private static Instant instant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }

    private static Row row(ResultSet rs) throws SQLException {
        byte[] linked = rs.getBytes("linked_user_id");
        int days = rs.getInt("keep_days");
        Integer keep = rs.wasNull() ? null : days;
        return new Row(Ids.uuid(rs.getBytes("id")), linked == null ? null : Ids.uuid(linked), rs.getString("name"), keep,
                instant(rs.getTimestamp("keep_since")), instant(rs.getTimestamp("caught_up")), rs.getInt("notes"));
    }

    private static String name(String raw) {
        String n = raw.strip();
        if (n.isEmpty() || n.length() > 200) {
            throw ApiException.badRequest("invalid_name");
        }
        return n;
    }

    private Map<UUID, List<DateEntry>> dates(byte[] me, UUID only) {
        Map<UUID, List<DateEntry>> out = new HashMap<>();
        String where = only == null ? "user_id = ?" : "user_id = ? AND contact_id = ?";
        Object[] args = only == null ? new Object[] {me} : new Object[] {me, Ids.bytes(only)};
        jdbc.query("SELECT contact_id, label, month_num, day_num, year_num FROM contact_dates WHERE " + where + " ORDER BY position", rs -> {
            int year = rs.getInt("year_num");
            Integer y = rs.wasNull() ? null : year;
            out.computeIfAbsent(Ids.uuid(rs.getBytes("contact_id")), k -> new ArrayList<>())
                    .add(new DateEntry(rs.getString("label"), rs.getInt("month_num"), rs.getInt("day_num"), y));
        }, args);
        return out;
    }

    private Entry entry(Row r, List<DateEntry> dates, Map<UUID, Person> connected) {
        Person p = r.linked() == null ? null : connected.get(r.linked());
        return new Entry(r.id(), r.name(), p, dates == null ? List.of() : dates, r.keepDays(), r.keepSince(), r.caughtUp(), r.notes());
    }

    /** My connections' short profiles (active accounts only). */
    private Map<UUID, Person> connections(byte[] me) {
        return people.persons(people.friendIds(me));
    }

    private Row myRow(byte[] me, UUID id) {
        return jdbc.query("SELECT " + COLUMNS + " FROM contacts c WHERE c.id = ? AND c.user_id = ?", (rs, i) -> row(rs), Ids.bytes(id), me)
                .stream().findFirst().orElseThrow(ApiException::notFound);
    }

    private Entry one(byte[] me, UUID id) {
        Row r = myRow(me, id);
        Map<UUID, Person> connected = r.linked() != null && people.friends(me, Ids.bytes(r.linked())) ? people.persons(List.of(r.linked())) : Map.of();
        return entry(r, dates(me, id).get(id), connected);
    }

    /** Everyone: my entries, then my connections I haven't written about, sorted by name. */
    @GetMapping("/v1/contacts")
    public Everyone all(@AuthenticationPrincipal Jwt jwt) {
        byte[] me = me(jwt);
        Map<UUID, Person> connected = connections(me);
        Map<UUID, List<DateEntry>> dates = dates(me, null);
        List<Entry> out = new ArrayList<>();
        Set<UUID> written = new HashSet<>();
        for (Row r : jdbc.query("SELECT " + COLUMNS + " FROM contacts c WHERE c.user_id = ?", (rs, i) -> row(rs), (Object) me)) {
            out.add(entry(r, dates.get(r.id()), connected));
            if (r.linked() != null) {
                written.add(r.linked());
            }
        }
        for (Person p : connected.values()) {
            if (!written.contains(p.userId())) {
                out.add(new Entry(null, p.name(), p, List.of(), null, null, null, 0));
            }
        }
        out.sort(Comparator.comparing((Entry e) -> e.name().toLowerCase()).thenComparing(Entry::name));
        return new Everyone(out);
    }

    @GetMapping("/v1/contacts/{id}")
    public Entry get(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        return one(me(jwt), id);
    }

    /** The connection, if they're mine and not already linked to another of my entries (404 / 409 already_linked). */
    private byte[] linkable(byte[] me, UUID userId) {
        byte[] other = Ids.bytes(userId);
        if (!people.friends(me, other) || !people.isActive(other)) {
            throw ApiException.notFound();
        }
        if (!jdbc.queryForList("SELECT 1 FROM contacts WHERE user_id = ? AND linked_user_id = ?", me, other).isEmpty()) {
            throw ApiException.conflict("already_linked");
        }
        return other;
    }

    @PostMapping("/v1/contacts")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    public Entry add(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody NewEntry r) {
        byte[] me = me(jwt);
        String name = name(r.name());
        byte[] linked = r.userId() == null ? null : linkable(me, r.userId());
        write(me);
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM contacts WHERE user_id = ?", Integer.class, (Object) me);
        if (count != null && count >= MAX_CONTACTS) {
            throw ApiException.conflict("too_many_contacts");
        }
        UUID id = Ids.newId();
        jdbc.update("INSERT INTO contacts (id, user_id, linked_user_id, name, created_at) VALUES (?, ?, ?, ?, ?)", Ids.bytes(id), me, linked, name,
                Timestamp.from(now()));
        return one(me, id);
    }

    private static DateEntry checked(DateEntry d) {
        String label = d.label().strip();
        if (label.isEmpty() || label.length() > 40) {
            throw ApiException.badRequest("invalid_date");
        }
        try {
            // A leap year when the year isn't known, so 29 February is allowed.
            LocalDate.of(d.year() == null ? 2000 : d.year(), d.month(), d.day());
        } catch (DateTimeException e) {
            throw ApiException.badRequest("invalid_date");
        }
        if (d.year() != null && (d.year() < 1900 || d.year() > Year.now(ZoneOffset.UTC).getValue())) {
            throw ApiException.badRequest("invalid_date");
        }
        return new DateEntry(label, d.month(), d.day(), d.year());
    }

    /** Saves the whole entry: name, rhythm and dates. Starting a rhythm notes when; changing it keeps that. */
    @PutMapping("/v1/contacts/{id}")
    @Transactional
    public Entry edit(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody EntryBody r) {
        byte[] me = me(jwt);
        Row old = myRow(me, id);
        String name = name(r.name());
        Integer keep = r.keepInTouchDays();
        if (keep != null && !RHYTHMS.contains(keep)) {
            throw ApiException.badRequest("invalid_rhythm");
        }
        List<DateEntry> dates = (r.dates() == null ? List.<DateEntry>of() : r.dates()).stream().map(ContactsController::checked).toList();
        Instant since = keep == null ? null : old.keepSince() != null ? old.keepSince() : now();
        jdbc.update("UPDATE contacts SET name = ?, keep_days = ?, keep_since = ? WHERE id = ? AND user_id = ?", name, keep,
                since == null ? null : Timestamp.from(since), Ids.bytes(id), me);
        jdbc.update("DELETE FROM contact_dates WHERE contact_id = ? AND user_id = ?", Ids.bytes(id), me);
        for (int i = 0; i < dates.size(); i++) {
            DateEntry d = dates.get(i);
            jdbc.update("""
                    INSERT INTO contact_dates (id, contact_id, user_id, label, month_num, day_num, year_num, position)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)""", Ids.bytes(Ids.newId()), Ids.bytes(id), me, d.label(), d.month(), d.day(), d.year(), i);
        }
        return one(me, id);
    }

    /** Deletes an entry and its notes; a connection is still listed (as one I haven't written about). */
    @DeleteMapping("/v1/contacts/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        if (jdbc.update("DELETE FROM contacts WHERE id = ? AND user_id = ?", Ids.bytes(id), me(jwt)) == 0) {
            throw ApiException.notFound();
        }
    }

    /** Links an entry to a connection (someone I knew before they joined, say). */
    @PutMapping("/v1/contacts/{id}/link")
    @Transactional
    public Entry link(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody Link r) {
        byte[] me = me(jwt);
        myRow(me, id);
        byte[] other = linkable(me, r.userId());
        jdbc.update("UPDATE contacts SET linked_user_id = ? WHERE id = ? AND user_id = ?", other, Ids.bytes(id), me);
        return one(me, id);
    }

    /** Unlinks an entry; it stays, and the connection is listed by themselves again. */
    @DeleteMapping("/v1/contacts/{id}/link")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unlink(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        myRow(me, id);
        jdbc.update("UPDATE contacts SET linked_user_id = NULL WHERE id = ? AND user_id = ?", Ids.bytes(id), me);
    }

    // --- the log ---

    /** An entry's notes and catch-ups, oldest first. */
    @GetMapping("/v1/contacts/{id}/notes")
    public List<Note> notes(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id) {
        byte[] me = me(jwt);
        myRow(me, id);
        return jdbc.query("SELECT id, body, caught_up, noted_at FROM contact_notes WHERE contact_id = ? AND user_id = ? ORDER BY noted_at, created_at",
                (rs, i) -> new Note(Ids.uuid(rs.getBytes(1)), rs.getString(2), rs.getBoolean(3), rs.getTimestamp(4).toInstant()), Ids.bytes(id), me);
    }

    /** Adds a note or a catch-up, stamped now (a catch-up dated earlier is stamped midday UTC that day). */
    @PostMapping("/v1/contacts/{id}/notes")
    @ResponseStatus(HttpStatus.CREATED)
    public Note addNote(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @Valid @RequestBody NoteBody r) {
        byte[] me = me(jwt);
        myRow(me, id);
        boolean caughtUp = Boolean.TRUE.equals(r.caughtUp());
        String body = r.body() == null ? "" : r.body().strip();
        if (body.length() > 10_000 || body.isEmpty() && !caughtUp) {
            throw ApiException.badRequest("invalid_note");
        }
        Instant now = now();
        Instant at = now;
        if (r.at() != null) {
            LocalDate today = LocalDate.now(ZoneOffset.UTC);
            // A day ahead is still "today" somewhere.
            if (!caughtUp || r.at().isAfter(today.plusDays(1)) || r.at().getYear() < 1900) {
                throw ApiException.badRequest("invalid_date");
            }
            if (!r.at().equals(today)) {
                at = r.at().atTime(LocalTime.NOON).toInstant(ZoneOffset.UTC);
            }
        }
        write(me);
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM contact_notes WHERE contact_id = ?", Integer.class, (Object) Ids.bytes(id));
        Integer total = jdbc.queryForObject("SELECT COUNT(*) FROM contact_notes WHERE user_id = ?", Integer.class, (Object) me);
        if (count != null && count >= MAX_NOTES || total != null && total >= MAX_NOTES_TOTAL) {
            throw ApiException.conflict("too_many_notes");
        }
        UUID noteId = Ids.newId();
        jdbc.update("INSERT INTO contact_notes (id, contact_id, user_id, body, caught_up, noted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                Ids.bytes(noteId), Ids.bytes(id), me, body, caughtUp, Timestamp.from(at), Timestamp.from(now));
        return new Note(noteId, body, caughtUp, at);
    }

    @DeleteMapping("/v1/contacts/{id}/notes/{noteId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteNote(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") UUID id, @PathVariable("noteId") UUID noteId) {
        if (jdbc.update("DELETE FROM contact_notes WHERE id = ? AND contact_id = ? AND user_id = ?", Ids.bytes(noteId), Ids.bytes(id), me(jwt)) == 0) {
            throw ApiException.notFound();
        }
    }
}
