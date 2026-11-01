package com.circlo.server.notify;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class DailyDigestsTest {

    @Test
    void saysWhatKindsOfThingsAreWaitingButNeverHowMany() {
        assertThat(DailyDigests.summary(1, 0, 0, 0)).isEqualTo("a new reply");
        assertThat(DailyDigests.summary(3, 0, 0, 0)).isEqualTo("new replies");
        assertThat(DailyDigests.summary(2, 0, 1, 0)).isEqualTo("new replies and a friend request");
        assertThat(DailyDigests.summary(2, 1, 4, 0)).isEqualTo("new replies, a new message and friend requests");
        assertThat(DailyDigests.summary(0, 0, 0, 1)).isEqualTo("a new friend");
        assertThat(DailyDigests.summary(1, 0, 0, 3)).isEqualTo("a new reply and new friends");
        assertThat(DailyDigests.summary(0, 0, 0, 0)).isEmpty();
    }

    @Test
    void addressesHaveNoTrailingSlashAndDefaults() {
        NotifyProperties p = new NotifyProperties(null, "https://web.example.test/", " ");
        assertThat(p.webBase()).isEqualTo("https://web.example.test");
        assertThat(p.apiBase()).isEqualTo("https://api.hellocirclo.com");
        assertThat(p.dailyScheduled()).isTrue();
    }
}
