package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.circlo.server.crypto.CircloCore;
import com.circlo.server.web.Ids;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Phase 5 server side: invites, opt-in search, requests, payload relay, encrypted profiles, address book.
 * Payloads and profiles are opaque bytes here; their crypto is tested in the core.
 */
class SocialFlowIT extends IntegrationTest {

    @Autowired
    private CircloCore core;

    private UUID epoch(TestApp a) {
        UUID e = Ids.newId();
        assertThat(call("POST", "/v1/epochs", Map.of("epochId", e.toString()), a.accessToken).getStatusCode().value()).isEqualTo(201);
        return e;
    }

    /** Alice creates an invite; Bob redeems it. Returns the inviter id Bob got back. */
    private UUID invite(TestApp alice, TestApp bob) {
        byte[] token = Ids.random(32);
        assertThat(call("POST", "/v1/invites", Map.of("tokenHash", core.inviteTokenHash(token)), alice.accessToken)
                .getStatusCode().value()).isEqualTo(201);
        var redeemed = call("POST", "/v1/invites/redeem", Map.of("token", token), bob.accessToken);
        assertThat(redeemed.getStatusCode().value()).isEqualTo(200);
        @SuppressWarnings("unchecked")
        Map<String, Object> identity = (Map<String, Object>) redeemed.getBody().get("identity");
        assertThat(b64(identity.get("ed25519Pub"))).isEqualTo(alice.ed25519Pub());
        // Single use.
        assertThat(call("POST", "/v1/invites/redeem", Map.of("token", token), bob.accessToken).getStatusCode().value()).isEqualTo(404);
        return UUID.fromString((String) redeemed.getBody().get("userId"));
    }

    @Test
    void inviteRequestAcceptExchangesPayloadsAndProfiles() {
        TestApp alice = new TestApp(this, "social_alice", "pw").register();
        TestApp bob = new TestApp(this, "social_bob", "pw").register();
        UUID aliceEpoch = epoch(alice);
        UUID bobEpoch = epoch(bob);
        byte[] aliceProfile = Ids.random(300);
        assertThat(call("PUT", "/v1/blobs/profile", Map.of("epochId", aliceEpoch.toString(), "ciphertext", aliceProfile, "version", 1),
                alice.accessToken).getStatusCode().value()).isEqualTo(200);
        byte[] bobProfile = Ids.random(300);
        call("PUT", "/v1/blobs/profile", Map.of("epochId", bobEpoch.toString(), "ciphertext", bobProfile, "version", 1), bob.accessToken);

        // Before any connection, profiles are hidden.
        assertThat(call("GET", "/v1/users/" + alice.userId + "/profile", null, bob.accessToken).getStatusCode().value()).isEqualTo(404);

        assertThat(invite(alice, bob)).isEqualTo(alice.userId);
        byte[] bobToAlice = Ids.random(160);
        var req = call("POST", "/v1/friends/requests",
                Map.of("toUserId", alice.userId.toString(), "epochId", bobEpoch.toString(), "payload", bobToAlice), bob.accessToken);
        assertThat(req.getStatusCode().value()).isEqualTo(201);

        // Alice sees an incoming request and can already read Bob's payload and profile (to see who's asking).
        assertThat(friends(alice)).containsExactly(Map.entry(bob.userId.toString(), "incoming"));
        assertThat(friends(bob)).containsExactly(Map.entry(alice.userId.toString(), "outgoing"));
        assertThat(b64(payloads(alice, bob.userId).get(0).get("ciphertext"))).isEqualTo(bobToAlice);
        assertThat(b64(call("GET", "/v1/users/" + bob.userId + "/profile", null, alice.accessToken).getBody().get("ciphertext")))
                .isEqualTo(bobProfile);

        byte[] aliceToBob = Ids.random(160);
        assertThat(call("POST", "/v1/friends/" + bob.userId + "/accept",
                Map.of("epochId", aliceEpoch.toString(), "payload", aliceToBob), alice.accessToken).getStatusCode().value()).isEqualTo(200);
        assertThat(friends(alice)).containsExactly(Map.entry(bob.userId.toString(), "accepted"));
        assertThat(b64(payloads(bob, alice.userId).get(0).get("ciphertext"))).isEqualTo(aliceToBob);
        var profile = call("GET", "/v1/users/" + alice.userId + "/profile", null, bob.accessToken);
        assertThat(b64(profile.getBody().get("ciphertext"))).isEqualTo(aliceProfile);
        assertThat(profile.getBody().get("epochId")).isEqualTo(aliceEpoch.toString());

        // A stranger sees nothing.
        TestApp eve = new TestApp(this, "social_eve", "pw").register();
        assertThat(call("GET", "/v1/users/" + alice.userId + "/profile", null, eve.accessToken).getStatusCode().value()).isEqualTo(404);
        assertThat(call("GET", "/v1/friend-payloads?from=" + alice.userId, null, eve.accessToken).getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void strangersCannotSendRequestsUnlessTheTargetIsDiscoverable() {
        TestApp carol = new TestApp(this, "social_carol", "pw").register();
        TestApp dan = new TestApp(this, "social_dan", "pw").register();
        UUID danEpoch = epoch(dan);
        Map<String, Object> req = Map.of("toUserId", carol.userId.toString(), "epochId", danEpoch.toString(), "payload", Ids.random(160));

        // Private by default: search finds nothing and requests are refused.
        assertThat(call("GET", "/v1/users/search?handle=social_carol", null, dan.accessToken).getStatusCode().value()).isEqualTo(404);
        assertThat(call("POST", "/v1/friends/requests", req, dan.accessToken).getStatusCode().value()).isEqualTo(403);

        // Carol opts in: exact-match search works and so do requests.
        call("PUT", "/v1/me/discoverable", Map.of("discoverable", true), carol.accessToken);
        var found = call("GET", "/v1/users/search?handle=Social_Carol", null, dan.accessToken);
        assertThat(found.getBody().get("userId")).isEqualTo(carol.userId.toString());
        assertThat(call("POST", "/v1/friends/requests", req, dan.accessToken).getStatusCode().value()).isEqualTo(201);
        assertThat(call("POST", "/v1/friends/requests", req, dan.accessToken).getStatusCode().value()).isEqualTo(409);

        // Declining removes the request and Dan's payload.
        assertThat(call("POST", "/v1/friends/" + dan.userId + "/decline", null, carol.accessToken).getStatusCode().value()).isEqualTo(200);
        assertThat(friends(carol)).isEmpty();
        assertThat(call("GET", "/v1/friend-payloads?from=" + dan.userId, null, carol.accessToken).getStatusCode().value()).isEqualTo(404);
    }

    @Test
    void inputsAreValidated() {
        TestApp a = new TestApp(this, "social_frank", "pw").register();
        TestApp b = new TestApp(this, "social_gina", "pw").register();
        UUID e = epoch(a);
        invite(b, a);
        // Payloads must be exactly 160 bytes; epochs must be mine; my own invite can't be redeemed.
        assertThat(call("POST", "/v1/friends/requests", Map.of("toUserId", b.userId.toString(), "epochId", e.toString(), "payload", Ids.random(159)),
                a.accessToken).getStatusCode().value()).isEqualTo(400);
        assertThat(call("POST", "/v1/friends/requests", Map.of("toUserId", b.userId.toString(), "epochId", Ids.newId().toString(), "payload", Ids.random(160)),
                a.accessToken).getBody()).isEqualTo(Map.of("error", "unknown_epoch"));
        byte[] token = Ids.random(32);
        call("POST", "/v1/invites", Map.of("tokenHash", core.inviteTokenHash(token)), a.accessToken);
        assertThat(call("POST", "/v1/invites/redeem", Map.of("token", token), a.accessToken).getBody()).isEqualTo(Map.of("error", "own_invite"));
        // Payload re-wraps (PUT) are only for accepted friends.
        assertThat(call("PUT", "/v1/friend-payloads", Map.of("toUserId", b.userId.toString(), "epochId", e.toString(), "ciphertext", Ids.random(160)),
                a.accessToken).getStatusCode().value()).isEqualTo(403);
    }

    @Test
    void addressBookIsVersioned() {
        TestApp a = new TestApp(this, "social_hank", "pw").register();
        assertThat(call("GET", "/v1/blobs/address_book", null, a.accessToken).getStatusCode().value()).isEqualTo(404);
        assertThat(call("PUT", "/v1/blobs/address_book", Map.of("ciphertext", Ids.random(500), "version", 1), a.accessToken)
                .getStatusCode().value()).isEqualTo(200);
        assertThat(call("PUT", "/v1/blobs/address_book", Map.of("ciphertext", Ids.random(500), "version", 1), a.accessToken)
                .getStatusCode().value()).isEqualTo(409);
        assertThat(call("PUT", "/v1/blobs/address_book", Map.of("ciphertext", Ids.random(500), "version", 2), a.accessToken)
                .getStatusCode().value()).isEqualTo(200);
        assertThat(call("GET", "/v1/blobs/address_book", null, a.accessToken).getBody().get("version")).isEqualTo(2);
        assertThat(call("PUT", "/v1/blobs/profile", Map.of("ciphertext", Ids.random(10), "version", 1), a.accessToken).getBody())
                .isEqualTo(Map.of("error", "epoch_required"));
    }

    private Map<String, String> friends(TestApp a) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> list = http().get().uri("/v1/friends").header("Authorization", "Bearer " + a.accessToken)
                .retrieve().body(List.class);
        Map<String, String> out = new java.util.LinkedHashMap<>();
        list.forEach(f -> out.put((String) f.get("userId"), (String) f.get("status")));
        return out;
    }

    private List<Map<String, Object>> payloads(TestApp me, UUID from) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> list = http().get().uri("/v1/friend-payloads?from=" + from)
                .header("Authorization", "Bearer " + me.accessToken).retrieve().body(List.class);
        return list;
    }
}
