-- Todos (2.0): personal to-do lists. Only their owner ever reads or changes them (TodosController checks user_id on
-- every statement). Everything goes with the account (cascades).

CREATE TABLE todo_lists (
    id          BINARY(16)   NOT NULL PRIMARY KEY,
    user_id     BINARY(16)   NOT NULL,
    name        VARCHAR(100) NOT NULL,
    -- General: made for everyone, where quick add puts things; can be renamed, never deleted. One per person.
    is_general  BOOLEAN      NOT NULL DEFAULT FALSE,
    general_of  BINARY(16)   AS (IF(is_general, user_id, NULL)) PERSISTENT,
    position    INT          NOT NULL,
    created_at  DATETIME(6)  NOT NULL,
    CONSTRAINT uq_todo_lists_general UNIQUE (general_of),
    INDEX ix_todo_lists_user (user_id, position),
    CONSTRAINT fk_todo_lists_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE todos (
    id           BINARY(16)   NOT NULL PRIMARY KEY,
    user_id      BINARY(16)   NOT NULL,
    list_id      BINARY(16)   NOT NULL,
    title        VARCHAR(500) NOT NULL,
    notes        TEXT         NULL,
    -- A calendar date, no time or zone: "today" is the phone's (the app sends it when ticking a repeat).
    due_date     DATE         NULL,
    repeat_rule  VARCHAR(10)  NULL,
    -- A monthly repeat's day of the month (31 stays 31 where a month has one, rather than drifting to 30).
    repeat_day   TINYINT      NULL,
    position     INT          NOT NULL,
    completed_at DATETIME(6)  NULL,
    created_at   DATETIME(6)  NOT NULL,
    INDEX ix_todos_user (user_id, completed_at),
    INDEX ix_todos_list (list_id, completed_at, position),
    CONSTRAINT fk_todos_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_todos_list FOREIGN KEY (list_id) REFERENCES todo_lists (id) ON DELETE CASCADE
);
