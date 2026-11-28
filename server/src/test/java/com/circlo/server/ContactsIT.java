package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

/**
 * The Rolodex, my personal CRM (`contacts` in code): my private notes, dates and catch-up rhythm for the people in my
 * life, on Circlo or not. Everyone I'm connected to is listed without my adding them; an entry about a connection is
 * linked to them, and the link drops (keeping my notes) when we stop being connected. Only I ever see any of it.
 */
class ContactsIT extends IntegrationTest {

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> people(TestUser u) {
        ResponseEntity<Map<String, Object>> r = u.call("GET", "/v1/contacts", null);
        assertThat(r.getStatusCode().value()).isEqualTo(200);
        return (List<Map<String, Object>>) r.getBody().get("people");
    }

    private static List<Object> names(TestUser u) {
        return people(u).stream().map(p -> p.get("name")).toList();
    }

    private static Map<String, Object> entry(TestUser u, String name) {
        return people(u).stream().filter(p -> name.equals(p.get("name"))).findFirst().orElseThrow();
    }

    private static Map<String, Object> add(TestUser u, Map<String, Object> body) {
        ResponseEntity<Map<String, Object>> r = u.call("POST", "/v1/contacts", body);
        assertThat(r.getStatusCode().value()).as(String.valueOf(r.getBody())).isEqualTo(201);
        return r.getBody();
    }

    private static Map<String, Object> body(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            m.put((String) kv[i], kv[i + 1]);
        }
        return m;
    }

    private static Map<String, Object> date(String label, int month, int day, Integer year) {
        return body("label", label, "month", month, "day", day, "year", year);
    }

    @Test
    void myConnectionsAreListedAndICanAddPeopleWhoArentOnCirclo() {
        TestUser a = user("kit_list_a");
        TestUser b = user("kit_list_b");
        assertThat(people(a)).isEmpty();
        a.befriend(b);

        Map<String, Object> virtual = entry(a, "kit_list_b");
        assertThat(virtual).containsEntry("contactId", null).containsEntry("noteCount", 0).containsEntry("keepInTouchDays", null);
        @SuppressWarnings("unchecked")
        Map<String, Object> person = (Map<String, Object>) virtual.get("person");
        assertThat(person).containsEntry("userId", b.userId.toString()).containsEntry("username", "kit_list_b").doesNotContainKey("email");

        Map<String, Object> grandma = add(a, body("name", "  Grandma  "));
        assertThat(grandma).containsEntry("name", "Grandma").containsEntry("person", null);
        assertThat(grandma.get("contactId")).isNotNull();
        add(a, body("name", "aunt Sara"));
        assertThat(names(a)).containsExactly("aunt Sara", "Grandma", "kit_list_b");

        // b sees only a (a connection), never a's entries.
        assertThat(names(b)).containsExactly("kit_list_a");
        assertThat(a.status("POST", "/v1/contacts", body("name", " "))).isEqualTo(400);
    }

    @Test
    void entriesAreMineAlone() {
        TestUser a = user("kit_own_a");
        TestUser c = user("kit_own_c");
        String id = (String) add(a, body("name", "Sam")).get("contactId");
        String note = (String) a.call("POST", "/v1/contacts/" + id + "/notes", body("body", "Likes jazz")).getBody().get("noteId");

        assertThat(c.status("GET", "/v1/contacts/" + id, null)).isEqualTo(404);
        assertThat(c.status("PUT", "/v1/contacts/" + id, body("name", "Mine now"))).isEqualTo(404);
        assertThat(c.status("GET", "/v1/contacts/" + id + "/notes", null)).isEqualTo(404);
        assertThat(c.status("POST", "/v1/contacts/" + id + "/notes", body("body", "x"))).isEqualTo(404);
        assertThat(c.status("DELETE", "/v1/contacts/" + id + "/notes/" + note, null)).isEqualTo(404);
        assertThat(c.status("DELETE", "/v1/contacts/" + id + "/link", null)).isEqualTo(404);
        assertThat(c.status("DELETE", "/v1/contacts/" + id, null)).isEqualTo(404);
        assertThat(names(c)).isEmpty();
        assertThat(a.call("GET", "/v1/contacts/" + id, null).getBody()).containsEntry("name", "Sam").containsEntry("noteCount", 1);
        assertThat(user("kit_own_anon").status("GET", "/v1/contacts", null)).isEqualTo(200);
        assertThat(call("GET", "/v1/contacts", null, null).getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void datesAndAKeepInTouchRhythm() {
        TestUser a = user("kit_dates");
        String id = (String) add(a, body("name", "Mum")).get("contactId");
        String path = "/v1/contacts/" + id;

        Map<String, Object> saved = a.call("PUT", path, body("name", "Mum", "keepInTouchDays", 30,
                "dates", List.of(date("Birthday", 3, 14, 1961), date("Anniversary", 2, 29, null)))).getBody();
        assertThat(saved).containsEntry("keepInTouchDays", 30).containsEntry("lastCaughtUp", null);
        assertThat(saved.get("keepSince")).isNotNull();
        assertThat(saved.get("dates")).isEqualTo(List.of(date("Birthday", 3, 14, 1961), date("Anniversary", 2, 29, null)));

        // Changing the rhythm keeps when it started; turning it off clears it.
        Object since = saved.get("keepSince");
        assertThat(a.call("PUT", path, body("name", "Mum", "keepInTouchDays", 90, "dates", List.of())).getBody())
                .containsEntry("keepInTouchDays", 90).containsEntry("keepSince", since).containsEntry("dates", List.of());
        assertThat(a.call("PUT", path, body("name", "Mum")).getBody()).containsEntry("keepInTouchDays", null).containsEntry("keepSince", null);

        int nextYear = LocalDate.now(ZoneOffset.UTC).getYear() + 1;
        for (Map<String, Object> bad : List.of(date("Birthday", 13, 1, null), date("Birthday", 4, 31, null), date("Birthday", 2, 29, 2023),
                date("Birthday", 1, 1, nextYear), date("Birthday", 1, 1, 1800), date(" ", 1, 1, null))) {
            assertThat(a.status("PUT", path, body("name", "Mum", "dates", List.of(bad)))).as(bad.toString()).isEqualTo(400);
        }
        assertThat(a.status("PUT", path, body("name", "Mum", "keepInTouchDays", 13))).isEqualTo(400);
        assertThat(a.status("PUT", path, body("name", ""))).isEqualTo(400);
    }

    @Test
    void notesAreADatedLogAndCatchUpsSetWhenILastCaughtUp() {
        TestUser a = user("kit_notes");
        String id = (String) add(a, body("name", "Ali")).get("contactId");
        String notes = "/v1/contacts/" + id + "/notes";

        assertThat(a.call("POST", notes, body("body", "  Starting a new job  ")).getBody()).containsEntry("body", "Starting a new job")
                .containsEntry("caughtUp", false);
        String lunch = (String) a.call("POST", notes, body("body", "Lunch", "caughtUp", true, "at", "2026-01-10")).getBody().get("noteId");
        Map<String, Object> call = a.call("POST", notes, body("caughtUp", true)).getBody();
        assertThat(call).containsEntry("body", "").containsEntry("caughtUp", true);
        assertThat(a.status("POST", notes, body("body", " "))).isEqualTo(400); // a plain note needs words
        assertThat(a.status("POST", notes, body("caughtUp", true, "at", LocalDate.now(ZoneOffset.UTC).plusDays(2).toString()))).isEqualTo(400);

        List<Map<String, Object>> log = a.get(notes);
        assertThat(log).extracting(n -> n.get("body")).containsExactly("Lunch", "Starting a new job", "");
        Map<String, Object> ali = a.call("GET", "/v1/contacts/" + id, null).getBody();
        assertThat(ali).containsEntry("noteCount", 3).containsEntry("lastCaughtUp", call.get("at"));

        // Deleting the latest catch-up falls back to the one before.
        assertThat(a.status("DELETE", notes + "/" + call.get("noteId"), null)).isEqualTo(204);
        assertThat((String) a.call("GET", "/v1/contacts/" + id, null).getBody().get("lastCaughtUp")).startsWith("2026-01-10");
        assertThat(a.status("DELETE", notes + "/" + lunch, null)).isEqualTo(204);
        assertThat(a.call("GET", "/v1/contacts/" + id, null).getBody()).containsEntry("lastCaughtUp", null).containsEntry("noteCount", 1);
    }

    @Test
    void anEntryCanBeLinkedToAConnectionOnce() {
        TestUser a = user("kit_link_a");
        TestUser b = user("kit_link_b");
        TestUser stranger = user("kit_link_x");
        a.befriend(b);

        // Writing about a connection makes an entry linked to them; they stop being listed twice.
        Map<String, Object> made = add(a, body("name", "Bilal", "userId", b.userId.toString()));
        assertThat(made).containsEntry("name", "Bilal");
        assertThat(names(a)).containsExactly("Bilal");
        assertThat(a.status("POST", "/v1/contacts", body("name", "Again", "userId", b.userId.toString()))).isEqualTo(409);
        assertThat(a.status("POST", "/v1/contacts", body("name", "X", "userId", stranger.userId.toString()))).isEqualTo(404);

        // Unlinking keeps my entry and lists the connection again.
        String bilal = (String) made.get("contactId");
        assertThat(a.call("DELETE", "/v1/contacts/" + bilal + "/link", null).getStatusCode().value()).isEqualTo(204);
        assertThat(names(a)).containsExactly("Bilal", "kit_link_b");
        assertThat(entry(a, "Bilal")).containsEntry("person", null);

        // An entry made before they joined is linked once we're connected.
        String old = (String) add(a, body("name", "Old friend")).get("contactId");
        assertThat(a.status("PUT", "/v1/contacts/" + old + "/link", body("userId", stranger.userId.toString()))).isEqualTo(404);
        assertThat(a.call("PUT", "/v1/contacts/" + old + "/link", body("userId", b.userId.toString())).getBody()).extracting("person")
                .isNotNull();
        assertThat(names(a)).containsExactly("Bilal", "Old friend");
        assertThat(a.status("PUT", "/v1/contacts/" + bilal + "/link", body("userId", b.userId.toString()))).isEqualTo(409);

        // Deleting a connection's entry forgets my notes; they're still listed as a connection.
        assertThat(a.status("DELETE", "/v1/contacts/" + old, null)).isEqualTo(204);
        assertThat(names(a)).containsExactly("Bilal", "kit_link_b");
    }

    @Test
    void theLinkDropsWhenWeStopBeingConnectedButMyNotesStay() {
        TestUser a = user("kit_drop_a");
        TestUser b = user("kit_drop_b");
        TestUser c = user("kit_drop_c");
        TestUser d = user("kit_drop_d");
        a.befriend(b);
        a.befriend(c);
        a.befriend(d);
        String withNotes = (String) add(a, body("name", "Bea", "userId", b.userId.toString())).get("contactId");
        a.call("POST", "/v1/contacts/" + withNotes + "/notes", body("body", "Met at uni"));
        add(a, body("name", "Cal", "userId", c.userId.toString())); // nothing written: let go with the link
        String dee = (String) add(a, body("name", "Dee", "userId", d.userId.toString())).get("contactId");
        a.call("PUT", "/v1/contacts/" + dee, body("name", "Dee", "keepInTouchDays", 7));

        // b unfriends a; a blocks c; d deletes their account.
        assertThat(b.status("DELETE", "/v1/friends/" + a.userId, null)).isEqualTo(200);
        assertThat(a.status("POST", "/v1/blocks/" + c.userId, null)).isEqualTo(200);
        assertThat(d.status("DELETE", "/v1/account", Map.of("password", TestUser.PASSWORD))).isEqualTo(200);

        assertThat(names(a)).containsExactly("Bea", "Dee");
        assertThat(entry(a, "Bea")).containsEntry("person", null).containsEntry("noteCount", 1).containsEntry("contactId", withNotes);
        assertThat(entry(a, "Dee")).containsEntry("person", null).containsEntry("keepInTouchDays", 7);

        // Connecting again doesn't relink by itself: b is listed as a connection, and Bea can be linked again.
        a.befriend(b);
        assertThat(names(a)).containsExactly("Bea", "Dee", "kit_drop_b");
    }

    @Test
    void entriesAreInMyExportAndGoWithMyAccount() {
        TestUser a = user("kit_export");
        String id = (String) add(a, body("name", "Nan")).get("contactId");
        a.call("PUT", "/v1/contacts/" + id, body("name", "Nan", "keepInTouchDays", 14, "dates", List.of(date("Birthday", 5, 2, null))));
        a.call("POST", "/v1/contacts/" + id + "/notes", body("body", "Loves gardening"));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> exported = (List<Map<String, Object>>) a.call("GET", "/v1/me/export", null).getBody().get("rolodex");
        assertThat(exported).singleElement().satisfies(e -> {
            assertThat(e).containsEntry("name", "Nan").containsEntry("keepInTouchDays", 14);
            assertThat(e.get("dates").toString()).contains("Birthday");
            assertThat(e.get("notes").toString()).contains("Loves gardening");
        });
    }
}
