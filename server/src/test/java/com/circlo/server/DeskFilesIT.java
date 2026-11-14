package com.circlo.server;

import static com.circlo.server.DeskTodosIT.board;
import static com.circlo.server.DeskTodosIT.items;
import static com.circlo.server.DeskTodosIT.part;
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
 * Desk files (owner decision 2026-11-14, boards 2026-11-15): documents, photos and videos on a board, each with a title
 * and an optional description, kept just for me (needs the circlo-media-test bucket). Only their owner can list, open,
 * change or delete them; anyone else gets 404. They count towards my storage and go when I delete them, their board or
 * my account.
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

    private Map<String, Object> addFile(TestUser u, String boardId, String fileName, String objectKey) {
        var r = u.call("POST", "/v1/desk/files", Map.of("boardId", boardId, "title", fileName, "fileName", fileName, "objectKey", objectKey));
        assertThat(r.getStatusCode().value()).as("add file").isEqualTo(201);
        return r.getBody();
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

    private int keptUploads(TestUser u) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM media_uploads WHERE desk_file_id IS NOT NULL AND owner_id = UNHEX(REPLACE(?, '-', ''))",
                Integer.class, u.userId.toString());
    }

    private List<Map<String, Object>> files(TestUser u, String boardId) {
        return u.list("GET", "/v1/desk/boards/" + boardId + "/files", null).getBody();
    }

    private byte[] download(String url) throws Exception {
        return client.send(HttpRequest.newBuilder(URI.create(url)).GET().build(), HttpResponse.BodyHandlers.ofByteArray()).body();
    }

    @Test
    void filesOnABoard() throws Exception {
        TestUser a = user("files_owner");
        String trip = board(a, "Karachi trip");
        assertThat(files(a, trip)).isEmpty();

        byte[] pdf = "%PDF-1.4 pretend".getBytes();
        Map<String, Object> f = addFile(a, trip, "Boarding pass.pdf", upload(a, pdf, "application/pdf"));
        assertThat(f).containsEntry("title", "Boarding pass.pdf").containsEntry("fileName", "Boarding pass.pdf").containsEntry("description", "")
                .containsEntry("mime", "application/pdf").containsEntry("kind", "file").containsEntry("sizeBytes", pdf.length)
                .containsEntry("boardId", trip).containsEntry("boardName", "Karachi trip").containsEntry("previewUrl", null).containsEntry("commentCount", 0);
        assertThat(download((String) f.get("url"))).isEqualTo(pdf);

        // A photo with its thumbnail, a title and a description.
        Map<String, Object> photo = new HashMap<>(Map.of("boardId", trip, "title", "Hotel view", "description", "From room 1204", "fileName", "Photo.jpg",
                "objectKey", upload(a, "jpeg".getBytes(), "image/jpeg"), "previewKey", upload(a, "thumb".getBytes(), "image/jpeg"), "width", 800, "height", 600));
        var p = a.call("POST", "/v1/desk/files", photo);
        assertThat(p.getStatusCode().value()).isEqualTo(201);
        assertThat(p.getBody()).containsEntry("kind", "image").containsEntry("width", 800).containsEntry("title", "Hotel view")
                .containsEntry("description", "From room 1204");
        assertThat(p.getBody().get("previewUrl")).isNotNull();

        // Newest first; the board counts them.
        assertThat(files(a, trip)).extracting(x -> x.get("title")).containsExactly("Hotel view", "Boarding pass.pdf");
        assertThat(a.call("GET", "/v1/desk/boards/" + trip, null).getBody()).containsEntry("files", 2);

        // Open one with its comments; change its title and description and move it to another board.
        String fileId = (String) f.get("id");
        a.call("POST", "/v1/desk/files/" + fileId + "/comments", Map.of("body", "Gate 22"));
        Map<String, Object> view = a.call("GET", "/v1/desk/files/" + fileId, null).getBody();
        assertThat(part(view, "file")).containsEntry("commentCount", 1);
        assertThat(items(view, "comments")).extracting(c -> c.get("body")).containsExactly("Gate 22");
        String docs = board(a, "Documents");
        var moved = a.call("PUT", "/v1/desk/files/" + fileId, Map.of("boardId", docs, "title", "Flight PK-301", "description", "Seat 14A"));
        assertThat(moved.getBody()).containsEntry("title", "Flight PK-301").containsEntry("description", "Seat 14A").containsEntry("boardId", docs)
                .containsEntry("fileName", "Boarding pass.pdf");
        assertThat(files(a, docs)).extracting(x -> x.get("title")).containsExactly("Flight PK-301");
        assertThat(a.status("PUT", "/v1/desk/files/" + fileId, Map.of("boardId", docs, "title", " "))).isEqualTo(400);

        // Deleting a file lets its upload go (and its comments); the sweeper then removes it from the bucket.
        assertThat(a.status("DELETE", "/v1/desk/files/" + fileId, null)).isEqualTo(200);
        assertThat(a.status("GET", "/v1/desk/files/" + fileId, null)).isEqualTo(404);
        assertThat(owned("desk_comments", a)).isZero();
        jdbc.update("UPDATE media_uploads SET created_at = ? WHERE desk_file_id IS NULL AND owner_id = (SELECT id FROM users WHERE username = 'files_owner')",
                Timestamp.from(Instant.EPOCH));
        sweeper.sweep();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM media_uploads WHERE owner_id = (SELECT id FROM users WHERE username = 'files_owner')",
                Integer.class)).isEqualTo(2); // the photo and its thumbnail, still kept

        // Deleting a board deletes everything on it and lets its files' uploads go.
        assertThat(a.status("DELETE", "/v1/desk/boards/" + trip, null)).isEqualTo(200);
        assertThat(owned("desk_files", a)).isZero();
        assertThat(keptUploads(a)).isZero();
    }

    @Test
    void keptFilesAreNotSweptAndCountTowardsStorage() throws Exception {
        TestUser a = user("files_storage");
        String b = board(a, "Stuff");
        addFile(a, b, "Notes.txt", upload(a, new byte[1200], "text/plain"));
        addFile(a, b, "Clip.mp4", upload(a, new byte[3000], "video/mp4"));
        jdbc.update("UPDATE media_uploads SET created_at = ?", Timestamp.from(Instant.EPOCH));
        sweeper.sweep();
        assertThat(files(a, b)).hasSize(2);

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
        String b = board(a, "B");
        String pdf = upload(a, "%PDF".getBytes(), "application/pdf");
        String thumb = upload(a, "t".getBytes(), "image/jpeg");
        Map<String, Object> media = Map.of("type", "image", "objectKey", pdf, "previewKey", thumb, "width", 10, "height", 10, "durationMs", 0);
        assertThat(a.call("POST", "/v1/posts", Map.of("text", "", "audience", Map.of("kind", "everyone"), "media", List.of(media))).getBody())
                .containsEntry("error", "wrong_media_type");
        addFile(a, b, "Doc.pdf", pdf);
        // Once filed, it can't be attached anywhere else, and a file can't be filed twice.
        assertThat(a.status("POST", "/v1/desk/files", Map.of("boardId", b, "title", "Again", "fileName", "Again.pdf", "objectKey", pdf))).isEqualTo(400);
    }

    @Test
    void nobodyElseCanSeeOrTouchMyFiles() throws Exception {
        TestUser a = user("files_mine");
        TestUser b = user("files_snoop");
        a.befriend(b, List.of(1), List.of(1));
        String board = board(a, "Private");
        String id = (String) addFile(a, board, "Secret.pdf", upload(a, "secret".getBytes(), "application/pdf")).get("id");

        assertThat(b.status("GET", "/v1/desk/boards/" + board + "/files", null)).isEqualTo(404);
        assertThat(b.status("GET", "/v1/desk/files/" + id, null)).isEqualTo(404);
        assertThat(b.status("PUT", "/v1/desk/files/" + id, Map.of("boardId", board, "title", "x"))).isEqualTo(404);
        assertThat(b.status("DELETE", "/v1/desk/files/" + id, null)).isEqualTo(404);
        assertThat(b.status("POST", "/v1/desk/files/" + id + "/comments", Map.of("body", "hi"))).isEqualTo(404);
        // Can't put things on my board, or file my upload as theirs.
        String theirs = upload(b, "x".getBytes(), "application/pdf");
        assertThat(b.status("POST", "/v1/desk/files", Map.of("boardId", board, "title", "x", "fileName", "x.pdf", "objectKey", theirs))).isEqualTo(404);
        String theirBoard = board(b, "Theirs");
        String mineUnfiled = upload(a, "y".getBytes(), "application/pdf");
        assertThat(b.call("POST", "/v1/desk/files", Map.of("boardId", theirBoard, "title", "y", "fileName", "y.pdf", "objectKey", mineUnfiled)).getBody())
                .containsEntry("error", "unknown_media");
        String theirFile = (String) addFile(b, theirBoard, "x.pdf", theirs).get("id");
        assertThat(b.status("PUT", "/v1/desk/files/" + theirFile, Map.of("boardId", board, "title", "moved"))).isEqualTo(404);

        assertThat(part(a.call("GET", "/v1/desk/files/" + id, null).getBody(), "file")).containsEntry("title", "Secret.pdf");
    }

    @Test
    void exportAndAccountDeletionIncludeTheDesk() throws Exception {
        TestUser a = user("files_export");
        String b = board(a, "Export board");
        String todo = (String) a.call("POST", "/v1/desk/todos", Map.of("boardId", b, "title", "Exported to-do")).getBody().get("id");
        a.call("POST", "/v1/desk/todos/" + todo + "/comments", Map.of("body", "Exported to-do comment"));
        String note = (String) a.call("POST", "/v1/desk/notes", Map.of("boardId", b, "title", "Exported note", "description", "body text")).getBody().get("id");
        a.call("POST", "/v1/desk/notes/" + note + "/comments", Map.of("body", "Exported note comment"));
        addFile(a, b, "Exported.pdf", upload(a, "pdf".getBytes(), "application/pdf"));

        String json = http().get().uri("/v1/me/export").header("Authorization", "Bearer " + a.accessToken).retrieve().body(String.class);
        assertThat(json).contains("Export board", "Exported to-do", "Exported to-do comment", "Exported note", "Exported note comment", "Exported.pdf");

        assertThat(a.status("DELETE", "/v1/account", Map.of("password", TestUser.PASSWORD))).isEqualTo(200);
        for (String table : List.of("desk_boards", "desk_todos", "desk_notes", "desk_files", "desk_comments", "media_uploads")) {
            assertThat(owned(table, a)).as(table).isZero();
        }
    }
}
