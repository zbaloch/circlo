package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.circlo.server.crypto.CircloCore;
import com.circlo.server.crypto.TestClientNative;
import com.circlo.server.web.Ids;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/**
 * Phase 9: the MLS delivery service is an opaque relay. Real MLS clients (via the test JNI client) run a 3-person
 * group where one person has two devices; removal; commit ordering by epoch; friend-only key package claims.
 */
class MessagingFlowIT extends IntegrationTest {

    @Autowired
    private CircloCore core;

    /** One device of a test user: its MLS client handle and the device id the server knows. */
    record Device(TestApp app, UUID deviceId, long mls) {}

    private Device device(TestApp app, UUID deviceId) {
        return new Device(app, deviceId, TestClientNative.mlsNew(app.identity, Ids.bytes(app.userId), Ids.bytes(deviceId)));
    }

    /** Registers a second device for an existing account. */
    private Device secondDevice(TestApp app) {
        UUID id = Ids.newId();
        byte[] keys = TestClientNative.generateDeviceKeys();
        byte[] pk = Arrays.copyOfRange(keys, 32, 64);
        var res = call("POST", "/v1/devices", Map.of("deviceId", id.toString(), "devicePubkey", pk,
                "deviceCert", TestClientNative.signDeviceCertificate(app.identity, Ids.bytes(app.userId), Ids.bytes(id), pk)), app.accessToken);
        assertThat(res.getStatusCode().value()).isEqualTo(201);
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
        byte[][] kps = TestClientNative.mlsKeyPackages(d.mls(), 3, true);
        var res = as(d, "PUT", "/v1/mls/key-packages",
                Map.of("keyPackages", Arrays.asList(kps).subList(0, 3), "lastResort", kps[3]));
        assertThat(res.getStatusCode().value()).isEqualTo(200);
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

    /** Claims one key package per device of the given users. */
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> claim(Device by, UUID... users) {
        var res = as(by, "POST", "/v1/mls/key-packages/claim", Map.of("userIds", Arrays.stream(users).map(UUID::toString).toList()));
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        return (List<Map<String, Object>>) res.getBody().get("keyPackages");
    }

    private long post(Device by, byte[] groupId, byte[] message, List<UUID> add, List<UUID> remove, byte[] welcome, int expect) {
        var body = new java.util.HashMap<String, Object>();
        body.put("message", message);
        body.put("addDevices", add.stream().map(UUID::toString).toList());
        body.put("removeDevices", remove.stream().map(UUID::toString).toList());
        if (welcome != null) {
            body.put("welcome", welcome);
        }
        var res = as(by, "POST", "/v1/mls/groups/" + Ids.uuid(groupId) + "/messages", body);
        assertThat(res.getStatusCode().value()).as("post status").isEqualTo(expect);
        return expect == 201 ? ((Number) res.getBody().get("seq")).longValue() : -1;
    }

    /** Joins every pending welcome for this device; returns the seq to read after. */
    private long joinWelcome(Device d, byte[] groupId) {
        List<Map<String, Object>> welcomes = list(d, "/v1/mls/welcomes");
        assertThat(welcomes).hasSize(1);
        Map<String, Object> w = welcomes.get(0);
        assertThat(TestClientNative.mlsJoin(d.mls(), b64(w.get("welcome")))).isEqualTo(groupId);
        assertThat(w.get("groupId")).isEqualTo(Ids.uuid(groupId).toString());
        assertThat(as(d, "DELETE", "/v1/mls/welcomes/" + w.get("welcomeId"), null).getStatusCode().value()).isEqualTo(200);
        return ((Number) w.get("afterSeq")).longValue();
    }

    /** Reads every message after `after` and returns the decrypted texts (commits are applied silently). */
    private List<String> read(Device d, byte[] groupId, long after) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> m : list(d, "/v1/mls/groups/" + Ids.uuid(groupId) + "/messages?after=" + after)) {
            byte[] plain = TestClientNative.mlsProcess(d.mls(), b64(m.get("message")));
            if (plain.length > 0) {
                out.add(new String(plain, StandardCharsets.UTF_8));
            }
        }
        return out;
    }

    private static byte[] utf8(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    @Test
    void threePeopleFourDevicesRemovalAndOrdering() {
        TestApp aliceApp = new TestApp(this, "msg_alice", "pw").register();
        TestApp bobApp = new TestApp(this, "msg_bob", "pw").register();
        TestApp carolApp = new TestApp(this, "msg_carol", "pw").register();
        befriend(aliceApp, bobApp);
        befriend(aliceApp, carolApp);

        Device alice = device(aliceApp, aliceApp.deviceId);
        Device alice2 = secondDevice(aliceApp);
        Device bob = device(bobApp, bobApp.deviceId);
        Device carol = device(carolApp, carolApp.deviceId);
        for (Device d : List.of(alice, alice2, bob, carol)) {
            uploadKeyPackages(d);
        }

        // Alice creates the group and adds Bob, Carol and her own second device.
        byte[] group = Ids.random(16);
        assertThat(as(alice, "POST", "/v1/mls/groups", Map.of("groupId", Ids.uuid(group).toString())).getStatusCode().value()).isEqualTo(201);
        TestClientNative.mlsCreateGroup(alice.mls(), group);
        List<Map<String, Object>> kps = new ArrayList<>(claim(alice, bobApp.userId, carolApp.userId));
        kps.addAll(claim(alice, aliceApp.userId).stream().filter(k -> !k.get("deviceId").equals(alice.deviceId().toString())).toList());
        assertThat(kps).hasSize(3);
        byte[][] out = TestClientNative.mlsAdd(alice.mls(), group, kps.stream().map(k -> b64(k.get("keyPackage"))).toArray(byte[][]::new));
        List<UUID> added = kps.stream().map(k -> UUID.fromString((String) k.get("deviceId"))).toList();
        post(alice, group, out[0], added, List.of(), out[1], 201);
        TestClientNative.mlsMerge(alice.mls(), group);

        long bobAfter = joinWelcome(bob, group);
        long carolAfter = joinWelcome(carol, group);
        long alice2After = joinWelcome(alice2, group);

        // A message reaches every other device, including Alice's second one.
        long hiSeq = post(bob, group, TestClientNative.mlsEncrypt(bob.mls(), group, utf8("hi from bob")), List.of(), List.of(), null, 201);
        assertThat(read(alice, group, hiSeq - 1)).containsExactly("hi from bob");
        assertThat(read(alice2, group, alice2After)).containsExactly("hi from bob");
        assertThat(read(carol, group, carolAfter)).containsExactly("hi from bob");

        // Ordering: Carol's commit at the current epoch wins; a second commit built at the same epoch is rejected.
        byte[] carolRemovesBob = TestClientNative.mlsRemove(carol.mls(), group, Ids.bytes(bob.deviceId()));
        byte[] staleFromAlice = TestClientNative.mlsRemove(alice.mls(), group, Ids.bytes(bob.deviceId()));
        long rmSeq = post(carol, group, carolRemovesBob, List.of(), List.of(bob.deviceId()), null, 201);
        TestClientNative.mlsMerge(carol.mls(), group);
        post(alice, group, staleFromAlice, List.of(), List.of(bob.deviceId()), null, 409);
        TestClientNative.mlsClear(alice.mls(), group);
        assertThat(read(alice, group, hiSeq)).isEmpty(); // applies Carol's commit
        assertThat(read(alice2, group, hiSeq)).isEmpty();

        // Bob is out: the server stops relaying to him, and his old keys can't read what's sent next.
        long secretSeq = post(alice2, group, TestClientNative.mlsEncrypt(alice2.mls(), group, utf8("bob is gone")), List.of(), List.of(), null, 201);
        assertThat(read(carol, group, rmSeq)).containsExactly("bob is gone");
        assertThat(as(bob, "GET", "/v1/mls/groups/" + Ids.uuid(group) + "/messages?after=0", null).getStatusCode().value()).isEqualTo(404);
        byte[] leaked = b64(list(carol, "/v1/mls/groups/" + Ids.uuid(group) + "/messages?after=" + (secretSeq - 1)).get(0).get("message"));
        assertThat(TestClientNative.mlsProcess(bob.mls(), carolRemovesBob)).isEmpty(); // he learns he was removed
        assertThatThrownBy(() -> TestClientNative.mlsProcess(bob.mls(), leaked)).isInstanceOf(RuntimeException.class);
        assertThat(post(bob, group, TestClientNative.mlsEncrypt(carol.mls(), group, utf8("x")), List.of(), List.of(), null, 404)).isEqualTo(-1);

        // The server only ever saw ids, epochs and ciphertext; key packages are consumed (last resort stays).
        assertThat(bobAfter).isGreaterThan(0);
    }

    @Test
    void strangersCantClaimKeysOrBeAdded() {
        TestApp aliceApp = new TestApp(this, "msg_dan", "pw").register();
        TestApp eveApp = new TestApp(this, "msg_eve", "pw").register();
        Device alice = device(aliceApp, aliceApp.deviceId);
        Device eve = device(eveApp, eveApp.deviceId);
        uploadKeyPackages(alice);
        uploadKeyPackages(eve);

        // Not friends: no key packages either way, and Eve's device can't be added to Alice's group.
        assertThat(as(eve, "POST", "/v1/mls/key-packages/claim", Map.of("userIds", List.of(aliceApp.userId.toString()))).getStatusCode().value())
                .isEqualTo(404);
        byte[] group = Ids.random(16);
        as(alice, "POST", "/v1/mls/groups", Map.of("groupId", Ids.uuid(group).toString()));
        TestClientNative.mlsCreateGroup(alice.mls(), group);
        byte[] eveKp = TestClientNative.mlsKeyPackages(eve.mls(), 1, false)[0];
        byte[][] out = TestClientNative.mlsAdd(alice.mls(), group, new byte[][] {eveKp});
        post(alice, group, out[0], List.of(eve.deviceId()), List.of(), out[1], 400);

        // A device header that isn't mine is refused; garbage isn't an MLS message.
        var wrongDevice = new Device(aliceApp, eve.deviceId(), alice.mls());
        assertThat(as(wrongDevice, "GET", "/v1/mls/welcomes", null).getStatusCode().value()).isEqualTo(403);
        post(alice, group, Ids.random(100), List.of(), List.of(), null, 400);

        // One-time key packages are handed out once; then the last-resort one keeps working.
        TestApp friend = new TestApp(this, "msg_fay", "pw").register();
        befriend(aliceApp, friend);
        Device fay = device(friend, friend.deviceId);
        for (int i = 0; i < 4; i++) {
            assertThat(claim(fay, aliceApp.userId)).hasSize(1);
        }
    }
}
