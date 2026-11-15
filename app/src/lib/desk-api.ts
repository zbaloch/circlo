/**
 * Desk server calls (owner decision 2026-11-14, boards 2026-11-15). Everything here is the signed-in person's own; the
 * server answers 404 for anything else. Nothing is cached on the device: screens load what they show when they open.
 */
import { api, ok } from '@/api/client';

import type { DeskBoard, DeskComment, DeskFile, DeskNote, DeskNoteSummary, DeskRepeat, DeskTodo } from './desk';

export type BoardInput = { name: string; description: string };
export type BoardTodos = { open: DeskTodo[]; done: DeskTodo[] };
export type TodoDetail = { todo: DeskTodo; history: DeskTodo[]; comments: DeskComment[] };
export type NoteDetail = { note: DeskNote; comments: DeskComment[] };
export type FileDetail = { file: DeskFile; comments: DeskComment[] };
export type TodoInput = { boardId: string; title: string; description?: string; dueDate?: string | null; repeat?: DeskRepeat | null };
export type NoteInput = { boardId: string; title: string; description: string; pinned?: boolean };
export type FileChange = { boardId: string; title: string; description: string };
/** What can take comments, as the server's paths name it. */
export type CommentsOn = 'todos' | 'notes' | 'files';

const path = (id: string) => ({ params: { path: { id } } });

// ---------------- boards ----------------

export async function fetchBoards(): Promise<DeskBoard[]> {
  return ok(await api.GET('/v1/desk/boards'));
}

export async function fetchBoard(id: string): Promise<DeskBoard> {
  return ok(await api.GET('/v1/desk/boards/{id}', path(id)));
}

export async function createBoard(board: BoardInput): Promise<DeskBoard> {
  return ok(await api.POST('/v1/desk/boards', { body: board }));
}

export async function updateBoard(id: string, board: BoardInput): Promise<DeskBoard> {
  return ok(await api.PUT('/v1/desk/boards/{id}', { ...path(id), body: board }));
}

export async function deleteBoard(id: string): Promise<void> {
  ok(await api.DELETE('/v1/desk/boards/{id}', path(id)));
}

// ---------------- to-dos ----------------

export async function fetchBoardTodos(boardId: string): Promise<BoardTodos> {
  return ok(await api.GET('/v1/desk/boards/{id}/todos', path(boardId)));
}

export async function fetchToday(date: string): Promise<DeskTodo[]> {
  return ok(await api.GET('/v1/desk/today', { params: { query: { date } } }));
}

export async function createTodo(input: TodoInput): Promise<DeskTodo> {
  return ok(await api.POST('/v1/desk/todos', { body: input }));
}

export async function fetchTodo(id: string): Promise<TodoDetail> {
  return ok(await api.GET('/v1/desk/todos/{id}', path(id)));
}

export async function updateTodo(id: string, input: TodoInput): Promise<DeskTodo> {
  return ok(await api.PUT('/v1/desk/todos/{id}', { ...path(id), body: input }));
}

export async function deleteTodo(id: string): Promise<void> {
  ok(await api.DELETE('/v1/desk/todos/{id}', path(id)));
}

/** Ticks a to-do off on my calendar day; a repeating one comes back as `next`. */
export async function completeTodo(id: string, today: string): Promise<{ todo: DeskTodo; next?: DeskTodo | null }> {
  return ok(await api.POST('/v1/desk/todos/{id}/done', { ...path(id), body: { today } }));
}

export async function uncompleteTodo(id: string): Promise<DeskTodo> {
  return ok(await api.DELETE('/v1/desk/todos/{id}/done', path(id)));
}

// ---------------- notes ----------------

export async function fetchBoardNotes(boardId: string): Promise<DeskNoteSummary[]> {
  return ok(await api.GET('/v1/desk/boards/{id}/notes', path(boardId)));
}

export async function fetchNote(id: string): Promise<NoteDetail> {
  return ok(await api.GET('/v1/desk/notes/{id}', path(id)));
}

export async function createNote(input: NoteInput): Promise<DeskNote> {
  return ok(await api.POST('/v1/desk/notes', { body: input }));
}

export async function updateNote(id: string, input: NoteInput): Promise<DeskNote> {
  return ok(await api.PUT('/v1/desk/notes/{id}', { ...path(id), body: input }));
}

export async function deleteNote(id: string): Promise<void> {
  ok(await api.DELETE('/v1/desk/notes/{id}', path(id)));
}

// ---------------- files ----------------

export async function fetchBoardFiles(boardId: string): Promise<DeskFile[]> {
  return ok(await api.GET('/v1/desk/boards/{id}/files', path(boardId)));
}

export async function fetchFile(id: string): Promise<FileDetail> {
  return ok(await api.GET('/v1/desk/files/{id}', path(id)));
}

export async function updateFile(id: string, change: FileChange): Promise<DeskFile> {
  return ok(await api.PUT('/v1/desk/files/{id}', { ...path(id), body: change }));
}

export async function deleteFile(id: string): Promise<void> {
  ok(await api.DELETE('/v1/desk/files/{id}', path(id)));
}

// ---------------- comments ----------------

export async function addComment(on: CommentsOn, id: string, body: string): Promise<DeskComment> {
  const req = { ...path(id), body: { body } };
  if (on === 'todos') return ok(await api.POST('/v1/desk/todos/{id}/comments', req));
  if (on === 'notes') return ok(await api.POST('/v1/desk/notes/{id}/comments', req));
  return ok(await api.POST('/v1/desk/files/{id}/comments', req));
}

export async function deleteComment(id: string): Promise<void> {
  ok(await api.DELETE('/v1/desk/comments/{id}', path(id)));
}
