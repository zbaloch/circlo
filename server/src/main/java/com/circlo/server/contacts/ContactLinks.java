package com.circlo.server.contacts;

import org.springframework.jdbc.core.JdbcTemplate;

/**
 * What happens to Rolodex entries (my personal CRM) when two people stop being connected (unfriend, decline, block)
 * or one of them deletes their account: each one's entry about the other loses its link but stays, with its notes, as
 * their own record; an entry with nothing written in it (no notes, dates or rhythm) is let go with the link.
 */
public final class ContactLinks {

    private static final String EMPTY = """
            keep_days IS NULL
            AND NOT EXISTS (SELECT 1 FROM contact_notes n WHERE n.contact_id = contacts.id)
            AND NOT EXISTS (SELECT 1 FROM contact_dates d WHERE d.contact_id = contacts.id)""";

    private ContactLinks() {}

    /** Both people's entries about each other. */
    public static void disconnect(JdbcTemplate jdbc, byte[] a, byte[] b) {
        drop(jdbc, a, b);
        drop(jdbc, b, a);
    }

    private static void drop(JdbcTemplate jdbc, byte[] owner, byte[] other) {
        jdbc.update("DELETE FROM contacts WHERE user_id = ? AND linked_user_id = ? AND " + EMPTY, owner, other);
        jdbc.update("UPDATE contacts SET linked_user_id = NULL WHERE user_id = ? AND linked_user_id = ?", owner, other);
    }

    /** Before an account is deleted: everyone's empty entries about it go (the rest are unlinked by the foreign key). */
    public static void accountDeleted(JdbcTemplate jdbc, byte[] user) {
        jdbc.update("DELETE FROM contacts WHERE linked_user_id = ? AND " + EMPTY, (Object) user);
    }
}
