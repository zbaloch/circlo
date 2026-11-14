-- Desk (owner decision 2026-11-14, boards 2026-11-15): a personal space of boards, each with its own to-dos, notes and
-- files, all of which take comments. Everything in it belongs to one person and is never shared with anyone: every row
-- has its owner, and every query is scoped to it.

-- Boards ("Home renovation", "Taxes 2026"), listed by name.
CREATE TABLE desk_boards (
    id         BINARY(16)   NOT NULL PRIMARY KEY,
    owner_id   BINARY(16)   NOT NULL,
    name       VARCHAR(400) NOT NULL,
    created_at DATETIME(6)  NOT NULL,
    INDEX ix_desk_boards_owner (owner_id, name),
    CONSTRAINT fk_desk_boards_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE
);

-- A to-do: a title, an optional description, and an optional due date and repeat. Due dates are calendar days on the
-- owner's own clock (no time, no zone). A repeating to-do, when done, makes the next one in its series: repeat_kind
-- daily / weekdays / weekly / monthly / yearly counts from repeat_anchor (the first due date, so the 31st doesn't drift
-- to the 28th), "after" counts repeat_every days from the day it was done. next_id points at the to-do it made, so
-- undoing "done" can take that back.
CREATE TABLE desk_todos (
    id            BINARY(16)    NOT NULL PRIMARY KEY,
    owner_id      BINARY(16)    NOT NULL,
    board_id      BINARY(16)    NOT NULL,
    title         VARCHAR(2000) NOT NULL,
    description   TEXT          NOT NULL,
    due_date      DATE          NULL,
    repeat_kind   VARCHAR(16)   NULL,
    repeat_every  SMALLINT      NOT NULL DEFAULT 1,
    repeat_anchor DATE          NULL,
    series_id     BINARY(16)    NULL,
    next_id       BINARY(16)    NULL,
    done_at       DATETIME(6)   NULL,
    created_at    DATETIME(6)   NOT NULL,
    INDEX ix_desk_todos_board (board_id, done_at, created_at),
    INDEX ix_desk_todos_due (owner_id, done_at, due_date),
    INDEX ix_desk_todos_series (series_id, done_at),
    CONSTRAINT fk_desk_todos_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_desk_todos_board FOREIGN KEY (board_id) REFERENCES desk_boards (id) ON DELETE CASCADE
);

-- Notes, like messages on a board with one reader: a title and an optional description.
CREATE TABLE desk_notes (
    id          BINARY(16)   NOT NULL PRIMARY KEY,
    owner_id    BINARY(16)   NOT NULL,
    board_id    BINARY(16)   NOT NULL,
    title       VARCHAR(800) NOT NULL,
    description MEDIUMTEXT   NOT NULL,
    pinned      BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  DATETIME(6)  NOT NULL,
    updated_at  DATETIME(6)  NOT NULL,
    INDEX ix_desk_notes_board (board_id, pinned, updated_at),
    CONSTRAINT fk_desk_notes_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_desk_notes_board FOREIGN KEY (board_id) REFERENCES desk_boards (id) ON DELETE CASCADE
);

-- A kept file: a title (the file's name to start with), an optional description, the upload, and a thumbnail or poster
-- frame for photos and videos. Deleting a file or board releases its uploads first (DeskFilesController,
-- DeskBoardsController), then the rows go.
CREATE TABLE desk_files (
    id          BINARY(16)   NOT NULL PRIMARY KEY,
    owner_id    BINARY(16)   NOT NULL,
    board_id    BINARY(16)   NOT NULL,
    title       VARCHAR(800) NOT NULL,
    description TEXT         NOT NULL,
    file_name   VARCHAR(800) NOT NULL,
    object_key  CHAR(64)     NOT NULL,
    preview_key CHAR(64)     NULL,
    mime        VARCHAR(100) NOT NULL,
    size_bytes  BIGINT       NOT NULL,
    width       INT          NOT NULL DEFAULT 0,
    height      INT          NOT NULL DEFAULT 0,
    duration_ms INT          NOT NULL DEFAULT 0,
    created_at  DATETIME(6)  NOT NULL,
    INDEX ix_desk_files_board (board_id, created_at),
    CONSTRAINT fk_desk_files_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_desk_files_board FOREIGN KEY (board_id) REFERENCES desk_boards (id) ON DELETE CASCADE
);

-- Comments on a to-do, note or file (exactly one of them), oldest first: the owner's own running log of how things
-- moved on. They go with what they're on.
CREATE TABLE desk_comments (
    id         BINARY(16)  NOT NULL PRIMARY KEY,
    owner_id   BINARY(16)  NOT NULL,
    todo_id    BINARY(16)  NULL,
    note_id    BINARY(16)  NULL,
    file_id    BINARY(16)  NULL,
    body       TEXT        NOT NULL,
    created_at DATETIME(6) NOT NULL,
    INDEX ix_desk_comments_todo (todo_id, created_at),
    INDEX ix_desk_comments_note (note_id, created_at),
    INDEX ix_desk_comments_file (file_id, created_at),
    CONSTRAINT ck_desk_comments_one CHECK ((todo_id IS NOT NULL) + (note_id IS NOT NULL) + (file_id IS NOT NULL) = 1),
    CONSTRAINT fk_desk_comments_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_desk_comments_todo FOREIGN KEY (todo_id) REFERENCES desk_todos (id) ON DELETE CASCADE,
    CONSTRAINT fk_desk_comments_note FOREIGN KEY (note_id) REFERENCES desk_notes (id) ON DELETE CASCADE,
    CONSTRAINT fk_desk_comments_file FOREIGN KEY (file_id) REFERENCES desk_files (id) ON DELETE CASCADE
);

-- Uploads kept in the Desk, so the sweeper leaves them alone and storage counts them. Office document types are longer
-- than the 40 characters photos and videos needed.
ALTER TABLE media_uploads
    ADD COLUMN desk_file_id BINARY(16) NULL,
    MODIFY mime VARCHAR(100) NOT NULL,
    ADD INDEX ix_media_uploads_desk (desk_file_id);
