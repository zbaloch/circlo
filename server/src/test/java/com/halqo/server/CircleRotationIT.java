package com.halqo.server;

import static org.assertj.core.api.Assertions.assertThat;

import com.halqo.server.crypto.HalqoCore;
import com.halqo.server.web.Ids;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/** Phase 6 server side: epoch rotation re-wraps for everyone (uniform sizes), unfriending removes all access. */
class CircleRotationIT extends IntegrationTest {

    @Autowired
    private HalqoCore core;

    @Autowired
    private JdbcTemplate jdbc;

    private UUID epoch(TestApp a) {
        UUID e = Ids.newId();
        call("POST", "/v1/epochs", Map.of("epochId", e.toString()), a.accessToken);
        return e;
    }

    private void befriend(TestApp inviter, UUID inviterEpoch, TestApp other, UUID otherEpoch) {
        byte[] token = Ids.random(32);
        call("POST", "/v1/invites", Map.of("tokenHash", core.inviteTokenHash(token)), inviter.accessToken);
        call("POST", "/v1/invites/redeem", Map.of("token", token), other.accessToken);
        call("POST", "/v1/friends/requests", Map.of("toUserId", inviter.userId.toString(), "epochId", otherEpoch.toString(),
                "payload", Ids.random(160)), other.accessToken);
        assertThat(call("POST", "/v1/friends/" + other.userId + "/accept",
                Map.of("epochId", inviterEpoch.toString(), "payload", Ids.random(160)), inviter.accessToken).getStatusCode().value())
                .isEqualTo(200);
    }

    private static Map<String, Object> item(TestApp to, UUID epoch) {
        return Map.of("toUserId", to.userId.toString(), "epochId", epoch.toString(), "ciphertext", Ids.random(160));
    }

    @Test
    void rotationReWrapsForFriendsAndPendingRequestsWithUniformSizes() {
        TestApp alice = new TestApp(this, "rot_alice", "pw").register();
        TestApp bob = new TestApp(this, "rot_bob", "pw").register();
        TestApp carol = new TestApp(this, "rot_carol", "pw").register();
        TestApp dave = new TestApp(this, "rot_dave", "pw").register();
        TestApp eve = new TestApp(this, "rot_eve", "pw").register();
        UUID e1 = epoch(alice);
        befriend(alice, e1, bob, epoch(bob));
        befriend(alice, e1, carol, epoch(carol));
        // Alice has a pending request to Dave (he's discoverable).
        call("PUT", "/v1/me/discoverable", Map.of("discoverable", true), dave.accessToken);
        call("POST", "/v1/friends/requests", Map.of("toUserId", dave.userId.toString(), "epochId", e1.toString(), "payload", Ids.random(160)),
                alice.accessToken);

        UUID e2 = epoch(alice);
        // A batch that includes a stranger is rejected as a whole: nothing is written.
        var bad = call("PUT", "/v1/friend-payloads/batch", Map.of("payloads", List.of(item(bob, e2), item(eve, e2))), alice.accessToken);
        assertThat(bad.getStatusCode().value()).isEqualTo(403);
        assertThat(payloadCount(alice, e2)).isZero();

        var ok = call("PUT", "/v1/friend-payloads/batch",
                Map.of("payloads", List.of(item(bob, e2), item(carol, e2), item(dave, e2))), alice.accessToken);
        assertThat(ok.getStatusCode().value()).isEqualTo(200);
        assertThat(payloadCount(alice, e2)).isEqualTo(3);

        // Server-side, every friend's payload looks the same: identical length whatever their circle.
        List<Integer> sizes = jdbc.queryForList(
                "SELECT LENGTH(hpke_ciphertext) FROM friend_payloads WHERE from_user = ?", Integer.class, (Object) Ids.bytes(alice.userId));
        assertThat(sizes).isNotEmpty().allMatch(s -> s == 160);

        // Bob now sees both epochs' payloads from Alice.
        assertThat(payloads(bob, alice.userId)).hasSize(2);
    }

    @Test
    void unfriendingRemovesKeysAndProfileAccessBothWays() {
        TestApp alice = new TestApp(this, "unf_alice", "pw").register();
        TestApp bob = new TestApp(this, "unf_bob", "pw").register();
        UUID ae = epoch(alice);
        befriend(alice, ae, bob, epoch(bob));
        call("PUT", "/v1/blobs/profile", Map.of("epochId", ae.toString(), "ciphertext", Ids.random(200), "version", 1), alice.accessToken);
        assertThat(call("GET", "/v1/users/" + alice.userId + "/profile", null, bob.accessToken).getStatusCode().value()).isEqualTo(200);

        assertThat(call("DELETE", "/v1/friends/" + bob.userId, null, alice.accessToken).getStatusCode().value()).isEqualTo(200);

        assertThat(call("GET", "/v1/friend-payloads?from=" + alice.userId, null, bob.accessToken).getStatusCode().value()).isEqualTo(404);
        assertThat(call("GET", "/v1/friend-payloads?from=" + bob.userId, null, alice.accessToken).getStatusCode().value()).isEqualTo(404);
        assertThat(call("GET", "/v1/users/" + alice.userId + "/profile", null, bob.accessToken).getStatusCode().value()).isEqualTo(404);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM friend_payloads WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)",
                Integer.class, Ids.bytes(alice.userId), Ids.bytes(bob.userId), Ids.bytes(bob.userId), Ids.bytes(alice.userId))).isZero();

        // After a rotation, the ex-friend can't be sent the new epoch's key.
        UUID e2 = epoch(alice);
        assertThat(call("PUT", "/v1/friend-payloads/batch", Map.of("payloads", List.of(item(bob, e2))), alice.accessToken)
                .getStatusCode().value()).isEqualTo(403);
        // Unfriending again is a 404.
        assertThat(call("DELETE", "/v1/friends/" + bob.userId, null, alice.accessToken).getStatusCode().value()).isEqualTo(404);
    }

    private int payloadCount(TestApp from, UUID epoch) {
        Integer n = jdbc.queryForObject("SELECT COUNT(*) FROM friend_payloads WHERE from_user = ? AND epoch_id = ?", Integer.class,
                Ids.bytes(from.userId), Ids.bytes(epoch));
        return n == null ? 0 : n;
    }

    private List<?> payloads(TestApp me, UUID from) {
        return http().get().uri("/v1/friend-payloads?from=" + from).header("Authorization", "Bearer " + me.accessToken)
                .retrieve().body(List.class);
    }
}
