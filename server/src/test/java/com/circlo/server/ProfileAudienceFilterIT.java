package com.circlo.server;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** On my own profile I can show only the posts I shared with Only me, Everyone, or one of my circles (owner request 2026-11-20). */
class ProfileAudienceFilterIT extends IntegrationTest {

    private static List<Object> texts(List<Map<String, Object>> posts) {
        return posts.stream().map(p -> p.get("text")).toList();
    }

    @Test
    void myPostsFilteredByWhoTheyWentTo() {
        TestUser a = user("filter_author");
        TestUser friend = user("filter_friend");
        a.befriend(friend, List.of(1), List.of());

        a.post("my mind", "onlyMe", List.of());
        a.post("for everyone", "everyone", List.of());
        a.post("close friends", "circles", List.of(1));
        a.post("family", "circles", List.of(2));
        a.post("close friends and family", "circles", List.of(1, 2));

        String mine = "/v1/users/" + a.userId + "/posts";
        assertThat(texts(a.get(mine))).hasSize(5);
        assertThat(texts(a.get(mine + "?audience=onlyMe"))).containsExactly("my mind");
        assertThat(texts(a.get(mine + "?audience=everyone"))).containsExactly("for everyone");
        assertThat(texts(a.get(mine + "?audience=1"))).containsExactly("close friends and family", "close friends");
        assertThat(texts(a.get(mine + "?audience=2"))).containsExactly("close friends and family", "family");
        assertThat(texts(a.get(mine + "?audience=99"))).isEmpty();

        // Paging keeps the filter.
        List<Map<String, Object>> first = a.get(mine + "?audience=1&limit=1");
        assertThat(texts(first)).containsExactly("close friends and family");
        assertThat(texts(a.get(mine + "?audience=1&limit=1&before=" + first.get(0).get("createdAt")))).containsExactly("close friends");

        // Nonsense is refused.
        assertThat(a.status("GET", mine + "?audience=circles", null)).isEqualTo(400);
    }

    @Test
    void nobodyCanFilterSomeoneElsesPostsByAudience() {
        TestUser a = user("filter_owner");
        TestUser friend = user("filter_reader");
        a.befriend(friend, List.of(1), List.of());
        a.post("close friends", "circles", List.of(1));

        // Asking which of someone's posts went to their circle 1 would reveal their circles, so it's refused.
        String theirs = "/v1/users/" + a.userId + "/posts";
        assertThat(texts(friend.get(theirs))).containsExactly("close friends");
        assertThat(friend.status("GET", theirs + "?audience=1", null)).isEqualTo(400);
        assertThat(friend.status("GET", theirs + "?audience=everyone", null)).isEqualTo(400);
    }
}
