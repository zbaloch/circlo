package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.circlo.server.crypto.CircloCore;
import com.circlo.server.crypto.TestClientNative;
import com.circlo.server.posts.MediaSweeper;
import com.circlo.server.push.PushSender;
import com.circlo.server.web.Ids;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/** Phase 10: revoking devices, adding a friend's new device to chats, chat media, device links, content-free push. */
class DevicesFlowIT extends IntegrationTest {

    /** Captures every push instead of sending it (production uses FCM when configured). */
    static final List<Map<String, Object>> PUSHES = new CopyOnWriteArrayList<>();

    @TestConfiguration
    static class CapturePush {
        @Bean
        @Primary
        PushSender capturingPushSender() {
            return (platform, token, data) -> PUSHES.add(Map.of("platform", platform, "token", new String(token, StandardCharsets.UTF_8), "data", data));
        }
    }

    @Autowired
    private CircloCore core;

    @Autowired
    private MediaSweeper sweeper;

    private final HttpClient httpClient = HttpClient.newHttpClient();

    record Device(TestApp app, UUID deviceId, long mls) {}

    private Device device(TestApp app, UUID deviceId) {
        return new Device(app, deviceId, TestClientNative.mlsNew(app.identity, Ids.bytes(app.userId), Ids.bytes(deviceId)));
    }

    private Device secondDevice(TestApp app) {
        UUID id = Ids.newId();
        byte[] keys = TestClientNative.generateDeviceKeys();
        byte[] pk = Arrays.copyOfRange(keys, 32, 64);
        assertThat(call("POST", "/v1/devices", Map.of("deviceId", id.toString(), "devicePubkey", pk,
                "deviceCert", TestClientNative.signDeviceCertificate(app.identity, Ids.bytes(app.userId), Ids.bytes(id), pk)), app.accessToken)
                .getStatusCode().value()).isEqualTo(201);
        return device(app, id);
    }

    private ResponseEntity<Map<String, Object>> as(Device d, String method, String path, Object body) {
        var spec = http().method(org.springframework.http.HttpMethod.valueOf(method)).uri(path)
                .header("Authorization", "Bearer " + d.app().accessToken).header("X-Circlo-Device", d.deviceId().toString());
        if (body != null) {
            spec = spec.contentType(MediaType.APPLICATION_JSON).body(body);
        }
        @SuppressWarnings("unchecked")
        var res = spec.retrieve().onStatus(s -> true, (q, r) -> {}).toEntity((Class<Map<String, Object>>) (Class<?>) Map.class);
        return res;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> list(Device d, String path) {
        return http().get().uri(path).header("Authorization", "Bearer " + d.app().accessToken)
                .header("X-Circlo-Device", d.deviceId().toString()).retrieve().body(List.class);
    }

    private void uploadKeyPackages(Device d) {
        byte[][] kps = TestClientNative.mlsKeyPackages(d.mls(), 2, true);
        assertThat(as(d, "PUT", "/v1/mls/key-packages", Map.of("keyPackages", Arrays.asList(kps).subList(0, 2), "lastResort", kps[2]))
                .getStatusCode().value()).isEqualTo(200);
    }

    private UUID epoch(TestApp a) {
        UUID e = Ids.newId();
        call("POST", "/v1/epochs", Map.of("epochId", e.toString()), a.accessToken);
        return e;
    }

    private void befriend(TestApp inviter, TestApp other) {
        byte[] token = Ids.random(32);
        call("POST", "/v1/invites", Map.of("tokenHash", core.inviteTokenHash(token)), inviter.accessToken);
        call("POST", "/v1/invites/redeem", Map.of("token", token), other.accessToken);
        call("POST", "/v1/friends/requests", Map.of("toUserId", inviter.userId.toString(), "epochId", epoch(other).toString(),
                "payload", Ids.random(416)), other.accessToken);
        call("POST", "/v1/friends/" + other.userId + "/accept", Map.of("epochId", epoch(inviter).toString(), "payload", Ids.random(416)),
                inviter.accessToken);
    }

    private long post(Device by, byte[] group, byte[] message, List<UUID> add, byte[] welcome) {
        var body = new HashMap<String, Object>();
        body.put("message", message);
        body.put("addDevices", add.stream().map(UUID::toString).toList());
        if (welcome != null) {
            body.put("welcome", welcome);
        }
        var res = as(by, "POST", "/v1/mls/groups/" + Ids.uuid(group) + "/messages", body);
        assertThat(res.getStatusCode().value()).isEqualTo(201);
        return ((Number) res.getBody().get("seq")).longValue();
    }

    @SuppressWarnings("unchecked")
    private byte[] claimDevice(Device by, UUID deviceId) {
        var res = as(by, "POST", "/v1/mls/key-packages/claim", Map.of("userIds", List.of(), "deviceIds", List.of(deviceId.toString())));
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        List<Map<String, Object>> kps = (List<Map<String, Object>>) res.getBody().get("keyPackages");
        assertThat(kps).hasSize(1);
        return b64(kps.get(0).get("keyPackage"));
    }

    @Test
    void newDeviceJoinsExistingChatThenRevocationCutsItOff() {
        TestApp aliceApp = new TestApp(this, "dev_alice", "pw").register();
        TestApp bobApp = new TestApp(this, "dev_bob", "pw").register();
        befriend(aliceApp, bobApp);
        Device alice = device(aliceApp, aliceApp.deviceId);
        Device bob = device(bobApp, bobApp.deviceId);
        uploadKeyPackages(alice);
        uploadKeyPackages(bob);

        byte[] group = Ids.random(16);
        as(alice, "POST", "/v1/mls/groups", Map.of("groupId", Ids.uuid(group).toString()));
        TestClientNative.mlsCreateGroup(alice.mls(), group);
        byte[][] out = TestClientNative.mlsAdd(alice.mls(), group, new byte[][] {claimDevice(alice, bob.deviceId())});
        post(alice, group, out[0], List.of(bob.deviceId()), out[1]);
        TestClientNative.mlsMerge(alice.mls(), group);
        TestClientNative.mlsJoin(bob.mls(), b64(list(bob, "/v1/mls/welcomes").get(0).get("welcome")));

        // Bob logs in on a new phone: Alice's app sees it is missing from the chat and adds it.
        Device bob2 = secondDevice(bobApp);
        uploadKeyPackages(bob2);
        List<Map<String, Object>> missing = list(alice, "/v1/mls/groups/" + Ids.uuid(group) + "/missing-devices");
        assertThat(missing).extracting(m -> m.get("deviceId")).containsExactly(bob2.deviceId().toString());
        byte[][] add = TestClientNative.mlsAdd(alice.mls(), group, new byte[][] {claimDevice(alice, bob2.deviceId())});
        post(alice, group, add[0], List.of(bob2.deviceId()), add[1]);
        TestClientNative.mlsMerge(alice.mls(), group);
        TestClientNative.mlsJoin(bob2.mls(), b64(list(bob2, "/v1/mls/welcomes").get(0).get("welcome")));
        assertThat(list(alice, "/v1/mls/groups/" + Ids.uuid(group) + "/missing-devices")).isEmpty();
        long hi = post(alice, group, TestClientNative.mlsEncrypt(alice.mls(), group, "hi both phones".getBytes(StandardCharsets.UTF_8)),
                List.of(), null);
        byte[] msg = b64(list(bob2, "/v1/mls/groups/" + Ids.uuid(group) + "/messages?after=" + (hi - 1)).get(0).get("message"));
        assertThat(new String(TestClientNative.mlsProcess(bob2.mls(), msg), StandardCharsets.UTF_8)).isEqualTo("hi both phones");

        // Bob revokes the new phone: it can no longer use the delivery service, isn't claimable, isn't "missing".
        assertThat(call("DELETE", "/v1/devices/" + bob2.deviceId(), null, bobApp.accessToken).getStatusCode().value()).isEqualTo(200);
        assertThat(as(bob2, "GET", "/v1/mls/welcomes", null).getStatusCode().value()).isEqualTo(403);
        assertThat(list(alice, "/v1/mls/groups/" + Ids.uuid(group) + "/missing-devices")).isEmpty();
        assertThat(as(alice, "POST", "/v1/mls/key-packages/claim", Map.of("userIds", List.of(), "deviceIds", List.of(bob2.deviceId().toString())))
                .getStatusCode().value()).isEqualTo(404);
        // Someone else's device can't be revoked.
        assertThat(call("DELETE", "/v1/devices/" + bob.deviceId(), null, aliceApp.accessToken).getStatusCode().value()).isEqualTo(404);
    }

    @SuppressWarnings("unchecked")
    @Test
    void chatMediaIsForMembersOnlyAndNotSwept() throws Exception {
        TestApp aliceApp = new TestApp(this, "cm_alice", "pw").register();
        TestApp bobApp = new TestApp(this, "cm_bob", "pw").register();
        TestApp carolApp = new TestApp(this, "cm_carol", "pw").register();
        befriend(aliceApp, bobApp);
        befriend(aliceApp, carolApp); // a friend, but not in the chat
        Device alice = device(aliceApp, aliceApp.deviceId);
        Device bob = device(bobApp, bobApp.deviceId);
        uploadKeyPackages(bob);
        byte[] group = Ids.random(16);
        as(alice, "POST", "/v1/mls/groups", Map.of("groupId", Ids.uuid(group).toString()));
        TestClientNative.mlsCreateGroup(alice.mls(), group);
        byte[][] out = TestClientNative.mlsAdd(alice.mls(), group, new byte[][] {claimDevice(alice, bob.deviceId())});
        post(alice, group, out[0], List.of(bob.deviceId()), out[1]);

        byte[] photo = Ids.random(4000);
        var slots = (List<Map<String, Object>>) (Object) http().post().uri("/v1/media/uploads").header("Authorization", "Bearer " + aliceApp.accessToken)
                .contentType(MediaType.APPLICATION_JSON).body(Map.of("sizes", List.of(photo.length))).retrieve().body(List.class);
        String key = (String) slots.get(0).get("objectKey");
        httpClient.send(HttpRequest.newBuilder(URI.create((String) slots.get(0).get("putUrl"))).PUT(HttpRequest.BodyPublishers.ofByteArray(photo)).build(),
                HttpResponse.BodyHandlers.discarding());
        assertThat(as(alice, "POST", "/v1/mls/groups/" + Ids.uuid(group) + "/media", Map.of("objectKeys", List.of(key))).getStatusCode().value())
                .isEqualTo(200);

        assertThat(status("POST", "/v1/media/download-urls", Map.of("objectKeys", List.of(key)), bobApp.accessToken)).isEqualTo(200);
        assertThat(status("POST", "/v1/media/download-urls", Map.of("objectKeys", List.of(key)), carolApp.accessToken)).isEqualTo(404);
        // Not swept as "unattached" even when old; attaching twice or to another group fails.
        jdbcUpdate("UPDATE media_uploads SET created_at = ? WHERE object_key = ?",
                java.sql.Timestamp.from(java.time.Instant.now().minus(java.time.Duration.ofHours(48))), key);
        sweeper.sweep();
        assertThat(status("POST", "/v1/media/download-urls", Map.of("objectKeys", List.of(key)), bobApp.accessToken)).isEqualTo(200);
        assertThat(as(alice, "POST", "/v1/mls/groups/" + Ids.uuid(group) + "/media", Map.of("objectKeys", List.of(key))).getStatusCode().value())
                .isEqualTo(400);
    }

    @Autowired
    private org.springframework.jdbc.core.JdbcTemplate jdbc;

    /** Status only (for endpoints that return lists). */
    private int status(String method, String path, Object body, String token) {
        var spec = http().method(org.springframework.http.HttpMethod.valueOf(method)).uri(path);
        if (token != null) {
            spec = spec.header("Authorization", "Bearer " + token);
        }
        if (body != null) {
            spec = spec.contentType(MediaType.APPLICATION_JSON).body(body);
        }
        return spec.retrieve().onStatus(s -> true, (q, r) -> {}).toBodilessEntity().getStatusCode().value();
    }

    private void jdbcUpdate(String sql, Object... args) {
        jdbc.update(sql, args);
    }

    @Test
    void deviceLinkIsSingleUseAndGivesTheNewDeviceASession() {
        TestApp aliceApp = new TestApp(this, "link_alice", "pw").register();
        byte[] linkId = Ids.random(32);
        byte[] sealed = Ids.random(600); // sealed to the new device's QR key by the core; opaque to the server
        assertThat(call("POST", "/v1/device-links", Map.of("linkId", linkId, "sealed", sealed), aliceApp.accessToken).getStatusCode().value())
                .isEqualTo(201);

        String path = "/v1/device-links/" + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(linkId);
        var first = call("GET", path, null, null);
        assertThat(first.getStatusCode().value()).isEqualTo(200);
        assertThat(b64(first.getBody().get("sealed"))).isEqualTo(sealed);
        assertThat(first.getBody().get("userId")).isEqualTo(aliceApp.userId.toString());
        String token = (String) first.getBody().get("accessToken");
        assertThat(status("GET", "/v1/devices", null, token)).isEqualTo(200);
        assertThat(call("GET", path, null, null).getStatusCode().value()).isEqualTo(404); // single use

        // Expired links are gone; links can't be created without a full session.
        byte[] old = Ids.random(32);
        call("POST", "/v1/device-links", Map.of("linkId", old, "sealed", sealed), aliceApp.accessToken);
        jdbcUpdate("UPDATE device_links SET expires_at = ? WHERE link_id = ?", java.sql.Timestamp.from(java.time.Instant.now().minusSeconds(1)), old);
        assertThat(call("GET", "/v1/device-links/" + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(old), null, null)
                .getStatusCode().value()).isEqualTo(404);
        assertThat(call("POST", "/v1/device-links", Map.of("linkId", Ids.random(32), "sealed", sealed), null).getStatusCode().value()).isEqualTo(401);
    }

    @Test
    void pushCarriesNoContentOrNames() throws Exception {
        PUSHES.clear();
        TestApp aliceApp = new TestApp(this, "push_alice", "pw").register();
        TestApp bobApp = new TestApp(this, "push_bob", "pw").register();
        befriend(aliceApp, bobApp);
        Device alice = device(aliceApp, aliceApp.deviceId);
        Device bob = device(bobApp, bobApp.deviceId);
        uploadKeyPackages(alice);
        assertThat(call("PUT", "/v1/devices/" + alice.deviceId() + "/push-token", Map.of("token", "fcm-token-alice", "platform", "android"),
                aliceApp.accessToken).getStatusCode().value()).isEqualTo(200);
        assertThat(call("PUT", "/v1/devices/" + bob.deviceId() + "/push-token", Map.of("token", "fcm-token-bob", "platform", "android"),
                bobApp.accessToken).getStatusCode().value()).isEqualTo(200);
        // Someone else's device can't register a token.
        assertThat(call("PUT", "/v1/devices/" + alice.deviceId() + "/push-token", Map.of("token", "x", "platform", "android"),
                bobApp.accessToken).getStatusCode().value()).isEqualTo(404);

        byte[] group = Ids.random(16);
        as(bob, "POST", "/v1/mls/groups", Map.of("groupId", Ids.uuid(group).toString()));
        TestClientNative.mlsCreateGroup(bob.mls(), group);
        byte[][] out = TestClientNative.mlsAdd(bob.mls(), group, new byte[][] {claimDevice(bob, alice.deviceId())});
        post(bob, group, out[0], List.of(alice.deviceId()), out[1]);
        TestClientNative.mlsMerge(bob.mls(), group);
        post(bob, group, TestClientNative.mlsEncrypt(bob.mls(), group, "secret dinner plans".getBytes(StandardCharsets.UTF_8)), List.of(), null);

        for (int i = 0; i < 50 && PUSHES.size() < 2; i++) {
            Thread.sleep(50);
        }
        List<Map<String, Object>> pushes = new ArrayList<>(PUSHES);
        assertThat(pushes).isNotEmpty();
        assertThat(pushes).allSatisfy(p -> {
            assertThat(p.get("token")).isEqualTo("fcm-token-alice"); // only the recipient, never the sender's own device
            assertThat(p.get("data")).isEqualTo(Map.of("type", "activity"));
        });
        String everything = pushes.toString();
        for (String leak : List.of("secret", "dinner", "push_bob", "push_alice", bobApp.userId.toString(), Ids.uuid(group).toString())) {
            assertThat(everything).doesNotContain(leak);
        }
    }
}
