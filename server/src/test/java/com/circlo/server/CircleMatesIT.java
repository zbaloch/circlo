package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * People in the same circle see each other (owner decision 2026-11-20): on a friend's profile I see the others who
 * share one of their circles with me, as one list sorted by name, with no circle name, id or grouping. It works for
 * circles whose owner has switched it on (Family and Close Friends start on, the rest off) and leaves out anyone who
 * has turned off "Show me to others in the same circles". People who appear in each other's list may send each other
 * a friend request.
 */
class CircleMatesIT extends IntegrationTest {

    private static final int FAMILY = 1;
    private static final int CLOSE_FRIENDS = 2;
    private static final int WORK = 4;

    private static List<Object> usernames(List<Map<String, Object>> people) {
        return people.stream().map(p -> p.get("username")).toList();
    }

    private static String mates(TestUser owner) {
        return "/v1/users/" + owner.userId + "/circle-mates";
    }

    @Test
    void peopleInTheSameCircleSeeEachOtherButNotTheCircle() {
        TestUser me = user("cm_owner");
        TestUser imran = user("cm_imran");
        TestUser zulfi = user("cm_zulfi");
        TestUser mum = user("cm_mum");
        TestUser dad = user("cm_dad");
        TestUser sister = user("cm_sister");
        TestUser coworker = user("cm_coworker");
        TestUser coworker2 = user("cm_coworker2");
        TestUser everyone = user("cm_everyone");
        TestUser stranger = user("cm_stranger");
        me.befriend(imran, List.of(CLOSE_FRIENDS), List.of());
        me.befriend(zulfi, List.of(CLOSE_FRIENDS), List.of());
        me.befriend(mum, List.of(FAMILY), List.of());
        me.befriend(dad, List.of(FAMILY), List.of());
        me.befriend(sister, List.of(FAMILY, CLOSE_FRIENDS), List.of());
        me.befriend(coworker, List.of(WORK), List.of());
        me.befriend(coworker2, List.of(WORK), List.of());
        me.befriend(everyone);

        // Close Friends see each other, Family see each other, and someone in both sees both, mixed and sorted by name.
        assertThat(usernames(imran.get(mates(me)))).containsExactly("cm_sister", "cm_zulfi");
        assertThat(usernames(mum.get(mates(me)))).containsExactly("cm_dad", "cm_sister");
        assertThat(usernames(sister.get(mates(me)))).containsExactly("cm_dad", "cm_imran", "cm_mum", "cm_zulfi");
        // Work starts off; Everyone isn't a circle anyone shares.
        assertThat(coworker.get(mates(me))).isEmpty();
        assertThat(everyone.get(mates(me))).isEmpty();

        // Each person is shown as on a post (and whether we're connected): never a circle, an email or a count.
        Map<String, Object> zulfiRow = imran.get(mates(me)).get(1);
        assertThat(zulfiRow.keySet()).containsExactlyInAnyOrder("userId", "name", "username", "avatarUrl", "relation");
        assertThat(zulfiRow).containsEntry("userId", zulfi.userId.toString()).containsEntry("relation", null);

        // Only my friends can ask; strangers get 404 as if I didn't exist. My own list is empty (I know my circles).
        assertThat(stranger.status("GET", mates(me), null)).isEqualTo(404);
        assertThat(me.get(mates(me))).isEmpty();

        // "See what they can see": I get exactly what Imran gets, and only for my friends.
        assertThat(usernames(me.get("/v1/me/preview/" + imran.userId + "/circle-mates"))).containsExactly("cm_sister", "cm_zulfi");
        assertThat(me.status("GET", "/v1/me/preview/" + stranger.userId + "/circle-mates", null)).isEqualTo(404);
        // Whether my friends are connected with each other is theirs, not mine: the preview never says.
        assertThat(imran.status("POST", "/v1/friends/requests", Map.of("toUserId", zulfi.userId.toString()))).isEqualTo(201);
        assertThat(me.get("/v1/me/preview/" + imran.userId + "/circle-mates")).allSatisfy(p -> assertThat(p.get("relation")).isNull());
        assertThat(imran.get(mates(me))).extracting(p -> p.get("relation")).containsExactly(null, "outgoing");

        // Someone I've asked but who hasn't accepted isn't shown, even in Close Friends.
        TestUser pending = user("cm_pending");
        String token = (String) pending.call("POST", "/v1/invites", null).getBody().get("token");
        assertThat(me.status("POST", "/v1/invites/redeem", Map.of("token", token))).isEqualTo(200);
        assertThat(me.status("POST", "/v1/friends/requests", Map.of("toUserId", pending.userId.toString(), "circles", List.of(CLOSE_FRIENDS))))
                .isEqualTo(201);
        assertThat(usernames(imran.get(mates(me)))).containsExactly("cm_sister", "cm_zulfi");

        // Circles decide it now: out of Close Friends, out of the list.
        me.call("PUT", "/v1/friends/" + zulfi.userId + "/circles", Map.of("circles", List.of()));
        assertThat(usernames(imran.get(mates(me)))).containsExactly("cm_sister");
    }

    @Test
    void theCircleOwnerSwitchesItOnOrOffPerCircle() {
        TestUser me = user("cs_owner");
        TestUser mum = user("cs_mum");
        TestUser sister = user("cs_sister");
        TestUser imran = user("cs_imran");
        TestUser coworker = user("cs_coworker");
        TestUser coworker2 = user("cs_coworker2");
        me.befriend(mum, List.of(FAMILY), List.of());
        me.befriend(sister, List.of(FAMILY, CLOSE_FRIENDS), List.of());
        me.befriend(imran, List.of(CLOSE_FRIENDS), List.of());
        me.befriend(coworker, List.of(WORK), List.of());
        me.befriend(coworker2, List.of(WORK), List.of());

        // New accounts: on for Family and Close Friends, off for the rest.
        List<Map<String, Object>> circles = me.get("/v1/circles");
        assertThat(circles).extracting(c -> c.get("name") + "=" + c.get("membersVisible"))
                .containsExactly("Family=true", "Close Friends=true", "School=false", "Work=false", "Acquaintances=false");

        // Work on: coworkers see each other.
        assertThat(me.status("PUT", "/v1/circles/" + WORK + "/members-visible", Map.of("visible", true))).isEqualTo(200);
        assertThat(usernames(coworker.get(mates(me)))).containsExactly("cs_coworker2");

        // Family off: Mum shares no switched-on circle with anyone now; my sister still sees Close Friends.
        assertThat(me.status("PUT", "/v1/circles/" + FAMILY + "/members-visible", Map.of("visible", false))).isEqualTo(200);
        assertThat(mum.get(mates(me))).isEmpty();
        assertThat(usernames(sister.get(mates(me)))).containsExactly("cs_imran");
        assertThat(me.get("/v1/circles").get(0)).containsEntry("membersVisible", false);

        // A circle I add starts off; one I don't have is 404; renaming keeps the switch as it is.
        Map<String, Object> created = me.call("POST", "/v1/circles", Map.of("name", "Cousins")).getBody();
        assertThat(created).containsEntry("membersVisible", false);
        assertThat(me.status("PUT", "/v1/circles/8/members-visible", Map.of("visible", true))).isEqualTo(404);
        me.call("PUT", "/v1/circles/" + created.get("id") + "/members-visible", Map.of("visible", true));
        me.call("PUT", "/v1/circles/" + created.get("id"), Map.of("name", "Cousins and aunts"));
        assertThat(me.get("/v1/circles").get(5)).containsEntry("name", "Cousins and aunts").containsEntry("membersVisible", true);

        // Only the owner can change it: my coworker switching "their" circle 4 changes theirs, not mine.
        coworker.call("PUT", "/v1/circles/" + WORK + "/members-visible", Map.of("visible", false));
        assertThat(usernames(coworker2.get(mates(me)))).containsExactly("cs_coworker");
    }

    @Test
    void anyoneCanHideThemselvesFromTheseLists() {
        TestUser me = user("ch_owner");
        TestUser imran = user("ch_imran");
        TestUser zulfi = user("ch_zulfi");
        me.befriend(imran, List.of(CLOSE_FRIENDS), List.of());
        me.befriend(zulfi, List.of(CLOSE_FRIENDS), List.of());

        assertThat(zulfi.call("GET", "/v1/me", null).getBody()).containsEntry("showInCircles", true);
        Map<String, Object> after = zulfi.call("PUT", "/v1/me/privacy", Map.of("showInCircles", false)).getBody();
        assertThat(after).containsEntry("showInCircles", false);

        assertThat(imran.get(mates(me))).isEmpty();
        assertThat(usernames(me.get("/v1/me/preview/" + imran.userId + "/circle-mates"))).isEmpty();
        // Hiding myself hides only me.
        assertThat(usernames(zulfi.get(mates(me)))).containsExactly("ch_imran");
        // And nobody can send me a request through it while I'm hidden.
        assertThat(imran.status("POST", "/v1/friends/requests", Map.of("toUserId", zulfi.userId.toString()))).isEqualTo(403);

        zulfi.call("PUT", "/v1/me/privacy", Map.of("showInCircles", true));
        assertThat(usernames(imran.get(mates(me)))).containsExactly("ch_zulfi");
    }

    @Test
    void circleMatesCanConnectWithEachOther() {
        TestUser me = user("cc_owner");
        TestUser imran = user("cc_imran");
        TestUser zulfi = user("cc_zulfi");
        TestUser coworker = user("cc_coworker");
        TestUser bilal = user("cc_bilal");
        me.befriend(imran, List.of(CLOSE_FRIENDS), List.of());
        me.befriend(zulfi, List.of(CLOSE_FRIENDS), List.of());
        me.befriend(coworker, List.of(WORK), List.of());
        me.befriend(bilal, List.of(CLOSE_FRIENDS), List.of());

        // Imran asks Zulfi; Zulfi sees the request and accepts; both lists say so.
        assertThat(imran.status("POST", "/v1/friends/requests", Map.of("toUserId", zulfi.userId.toString(), "circles", List.of()))).isEqualTo(201);
        assertThat(imran.get(mates(me))).filteredOn(p -> p.get("username").equals("cc_zulfi")).first().extracting(p -> p.get("relation"))
                .isEqualTo("outgoing");
        assertThat(zulfi.get(mates(me))).filteredOn(p -> p.get("username").equals("cc_imran")).first().extracting(p -> p.get("relation"))
                .isEqualTo("incoming");
        assertThat(zulfi.status("POST", "/v1/friends/" + imran.userId + "/accept", Map.of("circles", List.of()))).isEqualTo(200);
        assertThat(imran.get(mates(me))).filteredOn(p -> p.get("username").equals("cc_zulfi")).first().extracting(p -> p.get("relation"))
                .isEqualTo("accepted");

        // Someone not in a switched-on circle with them can't.
        assertThat(coworker.status("POST", "/v1/friends/requests", Map.of("toUserId", imran.userId.toString()))).isEqualTo(403);

        // Blocks hide people from each other, and stop requests.
        assertThat(bilal.status("POST", "/v1/blocks/" + imran.userId, null)).isEqualTo(200);
        assertThat(usernames(imran.get(mates(me)))).containsExactly("cc_zulfi");
        assertThat(usernames(bilal.get(mates(me)))).containsExactly("cc_zulfi");
        assertThat(imran.status("POST", "/v1/friends/requests", Map.of("toUserId", bilal.userId.toString()))).isEqualTo(404);
    }
}
