-- Todos, simplified (owner decision 2026-11-28): to-dos are a title and a tick, like pen and paper; no due dates or
-- repeats. Notes are a log under each to-do, each with the time it was added (like comments). Only their owner ever
-- reads or changes them. Todos isn't released yet, so nothing depends on the dropped columns.

CREATE TABLE todo_notes (
    id         BINARY(16)  NOT NULL PRIMARY KEY,
    todo_id    BINARY(16)  NOT NULL,
    user_id    BINARY(16)  NOT NULL,
    body       TEXT        NOT NULL,
    created_at DATETIME(6) NOT NULL,
    INDEX ix_todo_notes_todo (todo_id, created_at),
    CONSTRAINT fk_todo_notes_todo FOREIGN KEY (todo_id) REFERENCES todos (id) ON DELETE CASCADE,
    CONSTRAINT fk_todo_notes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Notes written so far become each to-do's first note, dated when the to-do was made.
INSERT INTO todo_notes (id, todo_id, user_id, body, created_at)
SELECT UNHEX(REPLACE(UUID(), '-', '')), id, user_id, notes, created_at FROM todos WHERE notes IS NOT NULL AND TRIM(notes) <> '';

ALTER TABLE todos DROP COLUMN notes, DROP COLUMN due_date, DROP COLUMN repeat_rule, DROP COLUMN repeat_day;
