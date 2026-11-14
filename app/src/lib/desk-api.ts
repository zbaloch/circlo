/**
 * Desk server calls (owner decision 2026-11-14). Everything here is the signed-in person's own; the server answers 404
 * for anything else. Nothing is cached on the device: screens load what they show when they open.
 */
import { api, ok } from '@/api/client';

import type { DeskFile, DeskFolderRef, DeskList, DeskListing, DeskNote, DeskNoteSummary, DeskFollowup, DeskRepeat, DeskTodo } from './desk';

export type ListDetail = { id: string; name: string; open: DeskTodo[]; done: DeskTodo[] };
export type TodoDetail = DeskTodo & { history: DeskTodo[] };
export type TodoInput = { listId: string; title: string; notes?: string; dueDate?: string | null; repeat?: DeskRepeat | null };

const path = (id: string) => ({ params: { path: { id } } });

// ---------------- to-dos ----------------

export async function fetchLists(): Promise<DeskList[]> {
  return ok(await api.GET('/v1/desk/lists'));
}

export async function createList(name: string): Promise<DeskList> {
  return ok(await api.POST('/v1/desk/lists', { body: { name } }));
}

export async function renameList(id: string, name: string): Promise<void> {
  ok(await api.PUT('/v1/desk/lists/{id}', { ...path(id), body: { name } }));
}

export async function deleteList(id: string): Promise<void> {
  ok(await api.DELETE('/v1/desk/lists/{id}', path(id)));
}

export async function fetchList(id: string): Promise<ListDetail> {
  return ok(await api.GET('/v1/desk/lists/{id}', path(id)));
}

export async function fetchToday(date: string): Promise<DeskTodo[]> {
  return ok(await api.GET('/v1/desk/today', { params: { query: { date } } }));
}

export async function createTodo(input: TodoInput): Promise<DeskTodo> {
  return ok(await api.POST('/v1/desk/todos', { body: input }));
}

export async function fetchTodo(id: string): Promise<TodoDetail> {
  return ok(await api.GET('/v1/desk/todos/{id}', path(id))) as TodoDetail;
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

export async function fetchNotes(): Promise<DeskNoteSummary[]> {
  return ok(await api.GET('/v1/desk/notes'));
}

export async function fetchNote(id: string): Promise<DeskNote> {
  return ok(await api.GET('/v1/desk/notes/{id}', path(id)));
}

export async function createNote(title: string, body: string): Promise<DeskNote> {
  return ok(await api.POST('/v1/desk/notes', { body: { title, body } }));
}

export async function updateNote(id: string, note: { title: string; body: string; pinned?: boolean }): Promise<DeskNote> {
  return ok(await api.PUT('/v1/desk/notes/{id}', { ...path(id), body: note }));
}

export async function deleteNote(id: string): Promise<void> {
  ok(await api.DELETE('/v1/desk/notes/{id}', path(id)));
}

export async function addFollowup(id: string, body: string): Promise<DeskFollowup> {
  return ok(await api.POST('/v1/desk/notes/{id}/followups', { ...path(id), body: { body } }));
}

export async function deleteFollowup(id: string, followupId: string): Promise<void> {
  ok(await api.DELETE('/v1/desk/notes/{id}/followups/{followupId}', { params: { path: { id, followupId } } }));
}

// ---------------- files ----------------

/** A level of my files: the top level for null. */
export async function fetchFolder(id: string | null): Promise<DeskListing> {
  return id ? ok(await api.GET('/v1/desk/folders/{id}', path(id))) : ok(await api.GET('/v1/desk/files'));
}

export async function createFolder(name: string, parentId: string | null): Promise<DeskFolderRef> {
  return ok(await api.POST('/v1/desk/folders', { body: { name, parentId } }));
}

export async function updateFolder(id: string, name: string, parentId: string | null): Promise<DeskFolderRef> {
  return ok(await api.PUT('/v1/desk/folders/{id}', { ...path(id), body: { name, parentId } }));
}

export async function deleteFolder(id: string): Promise<void> {
  ok(await api.DELETE('/v1/desk/folders/{id}', path(id)));
}

export async function updateFile(id: string, name: string, folderId: string | null): Promise<DeskFile> {
  return ok(await api.PUT('/v1/desk/files/{id}', { ...path(id), body: { name, folderId } }));
}

export async function deleteFile(id: string): Promise<void> {
  ok(await api.DELETE('/v1/desk/files/{id}', path(id)));
}

export async function fetchFile(id: string): Promise<DeskFile> {
  return ok(await api.GET('/v1/desk/files/{id}', path(id)));
}
