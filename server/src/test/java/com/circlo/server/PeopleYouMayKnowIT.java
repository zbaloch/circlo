package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Home's "People you may know" card (owner request 2026-11-20): the circle mates from all my friends' profiles that I'm
 * not connected with yet, grouped by the friend I'd know them through. Built on {@link CircleMatesIT}'s rules: no
 * circle names or ids, people who hid themselves left out, blocks either way left out.
 */
class PeopleYouMayKnowIT extends IntegrationTest {

    private static final int FAMILY = 1;
    private static final int CLOSE_FRIENDS = 2;
    private static final String PATH = "/v1/me/people-you-may-know";

    @SuppressWarnings("unchecked")
    private static List<String> people(Map<String, Object> group) {
        return ((List<Map<String, Object>>) group.get("people")).stream().map(p -> (String) p.get("username")).toList();
    }

    @SuppressWarnings("unchecked")
    private static String owner(Map<String, Object> group) {
        return (String) ((Map<String, Object>) group.get("owner")).get("username");
    }

    @Test
    void groupsTheCircleMatesImNotConnectedWithByTheFriendIKnowThemThrough() {
        TestUser zaheer = user("pk_zaheer");
        TestUser ali = user("pk_ali");
        TestUser imran = user("pk_imran");
        TestUser zulfi = user("pk_zulfi");
        TestUser sister = user("pk_sister");
        TestUser cousin = user("pk_cousin");
        TestUser loner = user("pk_loner");
        zaheer.befriend(imran, List.of(CLOSE_FRIENDS), List.of());
        zaheer.befriend(zulfi, List.of(CLOSE_FRIENDS), List.of());
        zaheer.befriend(sister, List.of(CLOSE_FRIENDS), List.of());
        ali.befriend(imran, List.of(FAMILY), List.of());
        ali.befriend(cousin, List.of(FAMILY), List.of());
        ali.befriend(zulfi, List.of(FAMILY), List.of());
        zaheer.befriend(loner);

        // Through Zaheer: Sister and Zulfi. Through Ali: Cousin and Zulfi again (each friend's group is whole). Sorted.
        List<Map<String, Object>> groups = imran.get(PATH);
        assertThat(groups).extracting(PeopleYouMayKnowIT::owner).containsExactly("pk_ali", "pk_zaheer");
        assertThat(people(groups.get(0))).containsExactly("pk_cousin", "pk_zulfi");
        assertThat(people(groups.get(1))).containsExactly("pk_sister", "pk_zulfi");
        // People as on a post, never a circle or an email.
        assertThat(groups.get(0).keySet()).containsExactlyInAnyOrder("owner", "people");
        @SuppressWarnings("unchecked")
        Map<String, Object> first = ((List<Map<String, Object>>) groups.get(0).get("people")).get(0);
        assertThat(first.keySet()).containsExactlyInAnyOrder("userId", "name", "username", "avatarUrl");

        // Once Imran asks Zulfi, Zulfi drops out of Imran's card, and Imran out of Zulfi's (a request is waiting there).
        assertThat(imran.status("POST", "/v1/friends/requests", Map.of("toUserId", zulfi.userId.toString()))).isEqualTo(201);
        groups = imran.get(PATH);
        assertThat(people(groups.get(0))).containsExactly("pk_cousin");
        assertThat(people(groups.get(1))).containsExactly("pk_sister");
        assertThat(zulfi.get(PATH)).allSatisfy(g -> assertThat(people(g)).doesNotContain("pk_imran"));

        // A friend whose group would be empty isn't listed; nobody in Everyone only.
        assertThat(imran.status("POST", "/v1/friends/requests", Map.of("toUserId", cousin.userId.toString()))).isEqualTo(201);
        assertThat(imran.get(PATH)).extracting(PeopleYouMayKnowIT::owner).containsExactly("pk_zaheer");
        assertThat(loner.get(PATH)).isEmpty();

        // Hidden people and blocks are left out, as on the profile.
        assertThat(sister.call("PUT", "/v1/me/privacy", Map.of("showInCircles", false)).getStatusCode().value()).isEqualTo(200);
        assertThat(imran.get(PATH)).isEmpty();
        assertThat(sister.call("PUT", "/v1/me/privacy", Map.of("showInCircles", true)).getStatusCode().value()).isEqualTo(200);
        assertThat(sister.status("POST", "/v1/blocks/" + imran.userId, null)).isEqualTo(200);
        assertThat(imran.get(PATH)).isEmpty();

        assertThat(status(null)).isEqualTo(401);
    }

    private int status(String token) {
        return call("GET", PATH, null, token).getStatusCode().value();
    }
}
