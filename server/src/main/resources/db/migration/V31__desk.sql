-- Desk (owner decision 2026-11-14): a personal space for to-dos, notes and files. Everything in it belongs to one
-- person and is never shared with anyone: every row has its owner, and every query is scoped to it.

-- To-do lists, oldest first.
CREATE TABLE desk_lists (
    id         BINARY(16)   NOT NULL PRIMARY KEY,
    owner_id   BINARY(16)   NOT NULL,
    name       VARCHAR(400) NOT NULL,
    created_at DATETIME(6)  NOT NULL,
    INDEX ix_desk_lists_owner (owner_id, created_at),
    CONSTRAINT fk_desk_lists_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

-- A to-do. Due dates are calendar days on the owner's own clock (no time, no zone). A repeating to-do, when done, makes
-- the next one in its series: repeat_kind daily / weekdays / weekly / monthly / yearly counts from repeat_anchor (the
-- first due date, so the 31st doesn't drift to the 28th), "after" counts repeat_every days from the day it was done.
-- next_id points at the to-do it made, so undoing "done" can take that back.
CREATE TABLE desk_todos (
    id            BINARY(16)    NOT NULL PRIMARY KEY,
    owner_id      BINARY(16)    NOT NULL,
    list_id       BINARY(16)    NOT NULL,
    title         VARCHAR(2000) NOT NULL,
    notes         TEXT          NULL,
    due_date      DATE          NULL,
    repeat_kind   VARCHAR(16)   NULL,
    repeat_every  SMALLINT      NOT NULL DEFAULT 1,
    repeat_anchor DATE          NULL,
    series_id     BINARY(16)    NULL,
    next_id       BINARY(16)    NULL,
    done_at       DATETIME(6)   NULL,
    created_at    DATETIME(6)   NOT NULL,
    INDEX ix_desk_todos_list (list_id, done_at, created_at),
    INDEX ix_desk_todos_due (owner_id, done_at, due_date),
    INDEX ix_desk_todos_series (series_id, done_at),
    CONSTRAINT fk_desk_todos_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_desk_todos_list FOREIGN KEY (list_id) REFERENCES desk_lists (id) ON DELETE CASCADE
);

-- Notes: a title and a body, with follow-ups added over time (a running log, oldest first).
CREATE TABLE desk_notes (
    id         BINARY(16)   NOT NULL PRIMARY KEY,
    owner_id   BINARY(16)   NOT NULL,
    title      VARCHAR(800) NOT NULL,
    body       MEDIUMTEXT   NOT NULL,
    pinned     BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at DATETIME(6)  NOT NULL,
    updated_at DATETIME(6)  NOT NULL,
    INDEX ix_desk_notes_owner (owner_id, pinned, updated_at),
    CONSTRAINT fk_desk_notes_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE desk_note_followups (
    id         BINARY(16)  NOT NULL PRIMARY KEY,
    note_id    BINARY(16)  NOT NULL,
    owner_id   BINARY(16)  NOT NULL,
    body       TEXT        NOT NULL,
    created_at DATETIME(6) NOT NULL,
    INDEX ix_desk_note_followups_note (note_id, created_at),
    CONSTRAINT fk_desk_note_followups_note FOREIGN KEY (note_id) REFERENCES desk_notes (id) ON DELETE CASCADE,
    CONSTRAINT fk_desk_note_followups_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Folders, nested; files at the top level have no folder. Deleting a folder releases its files' uploads first
-- (DeskFilesController), then the rows cascade.
CREATE TABLE desk_folders (
    id         BINARY(16)   NOT NULL PRIMARY KEY,
    owner_id   BINARY(16)   NOT NULL,
    parent_id  BINARY(16)   NULL,
    name       VARCHAR(400) NOT NULL,
    created_at DATETIME(6)  NOT NULL,
    INDEX ix_desk_folders_owner (owner_id, parent_id),
    CONSTRAINT fk_desk_folders_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_desk_folders_parent FOREIGN KEY (parent_id) REFERENCES desk_folders (id) ON DELETE CASCADE
);

-- A kept file: one upload, plus a thumbnail or poster frame for photos and videos.
CREATE TABLE desk_files (
    id          BINARY(16)   NOT NULL PRIMARY KEY,
    owner_id    BINARY(16)   NOT NULL,
    folder_id   BINARY(16)   NULL,
    name        VARCHAR(800) NOT NULL,
    object_key  CHAR(64)     NOT NULL,
    preview_key CHAR(64)     NULL,
    mime        VARCHAR(100) NOT NULL,
    size_bytes  BIGINT       NOT NULL,
    width       INT          NOT NULL DEFAULT 0,
    height      INT          NOT NULL DEFAULT 0,
    duration_ms INT          NOT NULL DEFAULT 0,
    created_at  DATETIME(6)  NOT NULL,
    INDEX ix_desk_files_owner (owner_id, folder_id),
    CONSTRAINT fk_desk_files_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_desk_files_folder FOREIGN KEY (folder_id) REFERENCES desk_folders (id) ON DELETE CASCADE
);

-- Uploads kept in the Desk, so the sweeper leaves them alone and storage counts them. Office document types are longer
-- than the 40 characters photos and videos needed.
ALTER TABLE media_uploads
    ADD COLUMN desk_file_id BINARY(16) NULL,
    MODIFY mime VARCHAR(100) NOT NULL,
    ADD INDEX ix_media_uploads_desk (desk_file_id);
