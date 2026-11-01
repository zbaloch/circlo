package com.circlo.server.notify;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class EmailDigestsTest {

    @Test
    void summarisesCountsInPlainWords() {
        assertThat(EmailDigests.summary(1, 0, 0, 0)).isEqualTo("a new reply");
        assertThat(EmailDigests.summary(3, 0, 0, 0)).isEqualTo("3 new replies");
        assertThat(EmailDigests.summary(2, 0, 1, 0)).isEqualTo("2 new replies and a friend request");
        assertThat(EmailDigests.summary(2, 1, 4, 0)).isEqualTo("2 new replies, a new message and 4 friend requests");
        assertThat(EmailDigests.summary(0, 0, 0, 1)).isEqualTo("a new friend");
        assertThat(EmailDigests.summary(1, 0, 0, 3)).isEqualTo("a new reply and 3 new friends");
        assertThat(EmailDigests.summary(0, 0, 0, 0)).isEmpty();
    }

    @Test
    void addressesHaveNoTrailingSlashAndDefaults() {
        NotifyProperties p = new NotifyProperties(null, "https://web.example.test/", " ");
        assertThat(p.webBase()).isEqualTo("https://web.example.test");
        assertThat(p.apiBase()).isEqualTo("https://api.hellocirclo.com");
        assertThat(p.emailDelay()).hasMinutes(15);
    }
}
