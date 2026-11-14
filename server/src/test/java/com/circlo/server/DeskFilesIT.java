package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.circlo.server.media.MediaSweeper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Desk files (owner decision 2026-11-14): documents, photos and videos in folders, kept just for me (needs the
 * circlo-media-test bucket). Only their owner can list, open, move or delete them; anyone else gets 404. They count
 * towards my storage and go when I delete them or my account.
 */
class DeskFilesIT extends IntegrationTest {

    private final HttpClient client = HttpClient.newHttpClient();

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    MediaSweeper sweeper;

    private String upload(TestUser u, byte[] bytes, String mime) throws Exception {
        var slots = u.list("POST", "/v1/desk/uploads", Map.of("files", List.of(Map.of("size", bytes.length, "mime", mime))));
        assertThat(slots.getStatusCode().value()).as("upload slot for " + mime).isEqualTo(200);
        Map<String, Object> slot = slots.getBody().get(0);
        var put = client.send(HttpRequest.newBuilder(URI.create((String) slot.get("putUrl"))).header("Content-Type", mime)
                .PUT(HttpRequest.BodyPublishers.ofByteArray(bytes)).build(), HttpResponse.BodyHandlers.discarding());
        assertThat(put.statusCode()).isEqualTo(200);
        return (String) slot.get("objectKey");
    }

    private Map<String, Object> addFile(TestUser u, String folderId, String name, String objectKey) {
        Map<String, Object> body = new HashMap<>(Map.of("name", name, "objectKey", objectKey));
        if (folderId != null) body.put("folderId", folderId);
        var r = u.call("POST", "/v1/desk/files", body);
        assertThat(r.getStatusCode().value()).as("add file").isEqualTo(201);
        return r.getBody();
    }

    private String folder(TestUser u, String name, String parentId) {
        Map<String, Object> body = new HashMap<>(Map.of("name", name));
        if (parentId != null) body.put("parentId", parentId);
        var r = u.call("POST", "/v1/desk/folders", body);
        assertThat(r.getStatusCode().value()).isEqualTo(201);
        return (String) r.getBody().get("id");
    }

    /** Status of a request for upload slots (a list when it works, an error object when it doesn't). */
    private int slotStatus(TestUser u, String mime, long size) {
        return http().post().uri("/v1/desk/uploads").header("Authorization", "Bearer " + u.accessToken)
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON).body(Map.of("files", List.of(Map.of("size", size, "mime", mime))))
                .retrieve().onStatus(st -> true, (req, res) -> {}).toBodilessEntity().getStatusCode().value();
    }

    private int owned(String table, TestUser u) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE owner_id = UNHEX(REPLACE(?, '-', ''))", Integer.class,
                u.userId.toString());
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> items(Map<String, Object> m, String key) {
        return (List<Map<String, Object>>) m.get(key);
    }

    private byte[] download(String url) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create(url)).GET().build(), HttpResponse.BodyHandlers.ofByteArray()).body();
    }

    @Test
    void foldersAndFiles() throws Exception {
        TestUser a = user("files_owner");
        Map<String, Object> root = a.call("GET", "/v1/desk/files", null).getBody();
        assertThat(items(root, "folders")).isEmpty();
        assertThat(items(root, "files")).isEmpty();
        assertThat(root.get("folder")).isNull();

        String trip = folder(a, "Karachi trip", null);
        String tickets = folder(a, "Tickets", trip);

        byte[] pdf = "%PDF-1.4 pretend".getBytes();
        Map<String, Object> f = addFile(a, tickets, "Boarding pass.pdf", upload(a, pdf, "application/pdf"));
        assertThat(f).containsEntry("name", "Boarding pass.pdf").containsEntry("mime", "application/pdf").containsEntry("kind", "file")
                .containsEntry("sizeBytes", pdf.length).containsEntry("folderId", tickets).containsEntry("previewUrl", null);
        assertThat(download((String) f.get("url"))).isEqualTo(pdf);

        // A photo with its thumbnail.
        Map<String, Object> photo = new HashMap<>(Map.of("name", "Hotel.jpg", "objectKey", upload(a, "jpeg".getBytes(), "image/jpeg"),
                "previewKey", upload(a, "thumb".getBytes(), "image/jpeg"), "width", 800, "height", 600, "folderId", trip));
        var p = a.call("POST", "/v1/desk/files", photo);
        assertThat(p.getStatusCode().value()).isEqualTo(201);
        assertThat(p.getBody()).containsEntry("kind", "image").containsEntry("width", 800);
        assertThat(p.getBody().get("previewUrl")).isNotNull();

        // The folder shows its subfolders and files, and the way back up.
        Map<String, Object> inTrip = a.call("GET", "/v1/desk/folders/" + trip, null).getBody();
        assertThat(((Map<?, ?>) inTrip.get("folder")).get("name")).isEqualTo("Karachi trip");
        assertThat(items(inTrip, "folders")).extracting(x -> x.get("name"), x -> x.get("items"))
                .containsExactly(org.assertj.core.groups.Tuple.tuple("Tickets", 1));
        assertThat(items(inTrip, "files")).extracting(x -> x.get("name")).containsExactly("Hotel.jpg");
        Map<String, Object> inTickets = a.call("GET", "/v1/desk/folders/" + tickets, null).getBody();
        assertThat(items(inTickets, "path")).extracting(x -> x.get("name")).containsExactly("Karachi trip", "Tickets");
        assertThat(items(a.call("GET", "/v1/desk/files", null).getBody(), "folders")).extracting(x -> x.get("name")).containsExactly("Karachi trip");

        // Rename and move a file to the top level; rename and move a folder.
        String fileId = (String) f.get("id");
        var moved = a.call("PUT", "/v1/desk/files/" + fileId, Map.of("name", "Flight.pdf"));
        assertThat(moved.getBody()).containsEntry("name", "Flight.pdf").containsEntry("folderId", null);
        assertThat(items(a.call("GET", "/v1/desk/files", null).getBody(), "files")).extracting(x -> x.get("name")).containsExactly("Flight.pdf");
        assertThat(a.status("PUT", "/v1/desk/folders/" + tickets, Map.of("name", "Old tickets"))).isEqualTo(200);
        assertThat(items(a.call("GET", "/v1/desk/files", null).getBody(), "folders")).extracting(x -> x.get("name"))
                .containsExactly("Karachi trip", "Old tickets");
        // A folder can't go inside itself or one of its own folders.
        assertThat(a.status("PUT", "/v1/desk/folders/" + trip, Map.of("name", "Karachi trip", "parentId", trip))).isEqualTo(400);
        assertThat(a.status("PUT", "/v1/desk/folders/" + tickets, Map.of("name", "Old tickets", "parentId", trip))).isEqualTo(200);
        assertThat(a.status("PUT", "/v1/desk/folders/" + trip, Map.of("name", "Karachi trip", "parentId", tickets))).isEqualTo(400);

        // Deleting a file lets its upload go; the sweeper then removes it from the bucket.
        assertThat(a.status("DELETE", "/v1/desk/files/" + fileId, null)).isEqualTo(200);
        assertThat(a.status("GET", "/v1/desk/files/" + fileId, null)).isEqualTo(404);
        jdbc.update("UPDATE media_uploads SET created_at = ? WHERE desk_file_id IS NULL AND owner_id = (SELECT id FROM users WHERE username = 'files_owner')",
                Timestamp.from(Instant.EPOCH));
        sweeper.sweep();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM media_uploads WHERE owner_id = (SELECT id FROM users WHERE username = 'files_owner')",
                Integer.class)).isEqualTo(2); // the photo and its thumbnail, still kept

        // Deleting a folder deletes everything in it, files in subfolders too.
        assertThat(a.status("DELETE", "/v1/desk/folders/" + trip, null)).isEqualTo(200);
        assertThat(a.status("GET", "/v1/desk/folders/" + tickets, null)).isEqualTo(404);
        assertThat(owned("desk_files", a)).isZero();
        assertThat(owned("desk_folders", a)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM media_uploads WHERE desk_file_id IS NOT NULL AND owner_id = UNHEX(REPLACE(?, '-', ''))",
                Integer.class, a.userId.toString())).isZero();
    }

    @Test
    void keptFilesAreNotSweptAndCountTowardsStorage() throws Exception {
        TestUser a = user("files_storage");
        addFile(a, null, "Notes.txt", upload(a, new byte[1200], "text/plain"));
        addFile(a, null, "Clip.mp4", upload(a, new byte[3000], "video/mp4"));
        jdbc.update("UPDATE media_uploads SET created_at = ?", Timestamp.from(Instant.EPOCH));
        sweeper.sweep();
        assertThat(a.call("GET", "/v1/desk/files", null).getBody().get("files")).asList().hasSize(2);

        Map<String, Object> s = a.call("GET", "/v1/me/storage", null).getBody();
        assertThat(((Number) s.get("usedBytes")).longValue()).isEqualTo(4200);
        assertThat(((Number) s.get("deskBytes")).longValue()).isEqualTo(4200);
        assertThat(((Number) s.get("deskFiles")).longValue()).isEqualTo(2);
        assertThat(((Number) s.get("videoBytes")).longValue()).isZero(); // Desk videos are counted as Desk files
    }

    @Test
    void onlySafeFileTypes() {
        TestUser a = user("files_types");
        for (String mime : List.of("text/html", "image/svg+xml", "application/javascript", "application/x-msdownload")) {
            assertThat(slotStatus(a, mime, 10)).as(mime).isEqualTo(400);
        }
        for (String mime : List.of("application/pdf", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "application/octet-stream", "audio/mpeg", "image/heic", "application/zip")) {
            assertThat(slotStatus(a, mime, 10)).as(mime).isEqualTo(200);
        }
        assertThat(slotStatus(a, "application/pdf", 101L * 1024 * 1024)).isEqualTo(400);
    }

    @Test
    void aDeskFileCantBeAttachedToAPostAndAPostedPhotoCantBeFiled() throws Exception {
        TestUser a = user("files_cross");
        String pdf = upload(a, "%PDF".getBytes(), "application/pdf");
        String thumb = upload(a, "t".getBytes(), "image/jpeg");
        Map<String, Object> media = Map.of("type", "image", "objectKey", pdf, "previewKey", thumb, "width", 10, "height", 10, "durationMs", 0);
        assertThat(a.call("POST", "/v1/posts", Map.of("text", "", "audience", Map.of("kind", "everyone"), "media", List.of(media))).getBody())
                .containsEntry("error", "wrong_media_type");
        addFile(a, null, "Doc.pdf", pdf);
        // Once filed, it can't be attached anywhere else, and a file can't be filed twice.
        assertThat(a.status("POST", "/v1/desk/files", Map.of("name", "Again.pdf", "objectKey", pdf))).isEqualTo(400);
    }

    @Test
    void nobodyElseCanSeeOrTouchMyFiles() throws Exception {
        TestUser a = user("files_mine");
        TestUser b = user("files_snoop");
        a.befriend(b, List.of(1), List.of(1));
        String dir = folder(a, "Private", null);
        String key = upload(a, "secret".getBytes(), "application/pdf");
        String id = (String) addFile(a, dir, "Secret.pdf", key).get("id");

        assertThat(items(b.call("GET", "/v1/desk/files", null).getBody(), "folders")).isEmpty();
        assertThat(b.status("GET", "/v1/desk/folders/" + dir, null)).isEqualTo(404);
        assertThat(b.status("PUT", "/v1/desk/folders/" + dir, Map.of("name", "x"))).isEqualTo(404);
        assertThat(b.status("DELETE", "/v1/desk/folders/" + dir, null)).isEqualTo(404);
        assertThat(b.status("GET", "/v1/desk/files/" + id, null)).isEqualTo(404);
        assertThat(b.status("PUT", "/v1/desk/files/" + id, Map.of("name", "x"))).isEqualTo(404);
        assertThat(b.status("DELETE", "/v1/desk/files/" + id, null)).isEqualTo(404);
        // Can't put things in my folder, or file my upload as theirs.
        assertThat(b.status("POST", "/v1/desk/folders", Map.of("name", "x", "parentId", dir))).isEqualTo(404);
        String theirs = upload(b, "x".getBytes(), "application/pdf");
        assertThat(b.status("POST", "/v1/desk/files", Map.of("name", "x.pdf", "objectKey", theirs, "folderId", dir))).isEqualTo(404);
        String mineUnfiled = upload(a, "y".getBytes(), "application/pdf");
        assertThat(b.call("POST", "/v1/desk/files", Map.of("name", "y.pdf", "objectKey", mineUnfiled)).getBody()).containsEntry("error", "unknown_media");
        String theirFolder = folder(b, "Theirs", null);
        assertThat(b.status("PUT", "/v1/desk/folders/" + theirFolder, Map.of("name", "Theirs", "parentId", dir))).isEqualTo(404);

        assertThat(a.call("GET", "/v1/desk/files/" + id, null).getBody()).containsEntry("name", "Secret.pdf");
    }

    @Test
    void exportAndAccountDeletionIncludeTheDesk() throws Exception {
        TestUser a = user("files_export");
        String list = (String) a.call("POST", "/v1/desk/lists", Map.of("name", "Export list")).getBody().get("id");
        a.call("POST", "/v1/desk/todos", Map.of("listId", list, "title", "Exported to-do"));
        String note = (String) a.call("POST", "/v1/desk/notes", Map.of("title", "Exported note", "body", "body text")).getBody().get("id");
        a.call("POST", "/v1/desk/notes/" + note + "/followups", Map.of("body", "Exported follow-up"));
        addFile(a, folder(a, "Exported folder", null), "Exported.pdf", upload(a, "pdf".getBytes(), "application/pdf"));

        String json = http().get().uri("/v1/me/export").header("Authorization", "Bearer " + a.accessToken).retrieve().body(String.class);
        assertThat(json).contains("Export list", "Exported to-do", "Exported note", "Exported follow-up", "Exported folder", "Exported.pdf");

        assertThat(a.status("DELETE", "/v1/account", Map.of("password", TestUser.PASSWORD))).isEqualTo(200);
        for (String table : List.of("desk_lists", "desk_todos", "desk_notes", "desk_note_followups", "desk_folders", "desk_files", "media_uploads")) {
            assertThat(owned(table, a)).as(table).isZero();
        }
    }
}
