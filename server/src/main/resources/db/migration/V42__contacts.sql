-- Keep in touch (personal CRM; owner decision 2026-11-28): my private entries about the people in my life, on Circlo
-- or not: dates to remember, a catch-up rhythm, and a dated log of notes. Only their owner ever reads them; the person
-- an entry is about never knows. An entry about a connection is linked to them (linked_user_id) only while we're
-- connected: unfriending, blocking or deleting the account drops the link and keeps the entry (or lets an empty one go).

CREATE TABLE contacts (
    id             BINARY(16)   NOT NULL PRIMARY KEY,
    user_id        BINARY(16)   NOT NULL,
    linked_user_id BINARY(16)   NULL,
    name           VARCHAR(200) NOT NULL,
    keep_days      SMALLINT     NULL,
    keep_since     DATETIME(6)  NULL,
    created_at     DATETIME(6)  NOT NULL,
    CONSTRAINT uq_contacts_linked UNIQUE (user_id, linked_user_id),
    INDEX ix_contacts_linked_user (linked_user_id),
    CONSTRAINT fk_contacts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_contacts_linked_user FOREIGN KEY (linked_user_id) REFERENCES users (id) ON DELETE SET NULL
);

-- Birthdays, anniversaries and other days to remember: a month and day, with the year when it's known.
CREATE TABLE contact_dates (
    id         BINARY(16)  NOT NULL PRIMARY KEY,
    contact_id BINARY(16)  NOT NULL,
    user_id    BINARY(16)  NOT NULL,
    label      VARCHAR(40) NOT NULL,
    month_num  TINYINT     NOT NULL,
    day_num    TINYINT     NOT NULL,
    year_num   SMALLINT    NULL,
    position   TINYINT     NOT NULL,
    INDEX ix_contact_dates_contact (contact_id, position),
    INDEX ix_contact_dates_user (user_id),
    CONSTRAINT fk_contact_dates_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
    CONSTRAINT fk_contact_dates_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- The log: notes, and catch-ups (caught_up) that set when I last caught up with them. noted_at is when it happened
-- (a catch-up can be dated earlier); created_at keeps the order of things written the same moment.
CREATE TABLE contact_notes (
    id         BINARY(16)  NOT NULL PRIMARY KEY,
    contact_id BINARY(16)  NOT NULL,
    user_id    BINARY(16)  NOT NULL,
    body       TEXT        NOT NULL,
    caught_up  BOOLEAN     NOT NULL DEFAULT FALSE,
    noted_at   DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    INDEX ix_contact_notes_contact (contact_id, noted_at),
    INDEX ix_contact_notes_user (user_id),
    CONSTRAINT fk_contact_notes_contact FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE,
    CONSTRAINT fk_contact_notes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
