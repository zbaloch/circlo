/**
 * Todos (2.0; owner decisions 2026-11-27/28): personal to-do lists, like pen and paper. A to-do is a title and a tick,
 * in my order within its list; its notes are a log of dated entries, like comments. Only I ever see them (the server
 * answers anyone else with 404). No dates, repeats, reminders or badges.
 */
import { api, ok } from '@/api/client';
import type { components } from '@/api/schema';

export type TodoList = components['schemas']['TodoList'];
export type Todo = components['schemas']['Todo'];
export type TodoNote = components['schemas']['TodoNote'];
export type TodoFields = { title: string; listId: string | null };

// --- the API ---

/** For calls the server answers with 204 No Content: fine when it says so, an ApiError otherwise. */
function done(res: { data?: unknown; error?: unknown; response: Response }): void {
  if (!res.response.ok) ok(res);
}

export async function loadTodos(): Promise<{ lists: TodoList[]; todos: Todo[] }> {
  return ok(await api.GET('/v1/todos'));
}

export async function addTodo(fields: TodoFields): Promise<Todo> {
  return ok(await api.POST('/v1/todos', { body: fields }));
}

export async function saveTodo(todoId: string, fields: TodoFields): Promise<Todo> {
  return ok(await api.PUT('/v1/todos/{todoId}', { params: { path: { todoId } }, body: fields }));
}

export async function deleteTodo(todoId: string): Promise<void> {
  done(await api.DELETE('/v1/todos/{todoId}', { params: { path: { todoId } } }));
}

export async function completeTodo(todoId: string): Promise<Todo> {
  return ok(await api.POST('/v1/todos/{todoId}/complete', { params: { path: { todoId } } }));
}

export async function reopenTodo(todoId: string): Promise<Todo> {
  return ok(await api.POST('/v1/todos/{todoId}/reopen', { params: { path: { todoId } } }));
}

/** Completed to-dos (the last 30 days'), newest first: one list's, or all of them. */
export async function loadCompleted(listId: string | null): Promise<Todo[]> {
  if (!listId) return ok(await api.GET('/v1/todos/completed'));
  return ok(await api.GET('/v1/todos/lists/{listId}/completed', { params: { path: { listId } } }));
}

export async function loadNotes(todoId: string): Promise<TodoNote[]> {
  return ok(await api.GET('/v1/todos/{todoId}/notes', { params: { path: { todoId } } }));
}

export async function addNote(todoId: string, body: string): Promise<TodoNote> {
  return ok(await api.POST('/v1/todos/{todoId}/notes', { params: { path: { todoId } }, body: { body } }));
}

export async function deleteNote(todoId: string, noteId: string): Promise<void> {
  done(await api.DELETE('/v1/todos/{todoId}/notes/{noteId}', { params: { path: { todoId, noteId } } }));
}

export async function addList(name: string): Promise<TodoList> {
  return ok(await api.POST('/v1/todos/lists', { body: { name } }));
}

export async function renameList(listId: string, name: string): Promise<TodoList> {
  return ok(await api.PUT('/v1/todos/lists/{listId}', { params: { path: { listId } }, body: { name } }));
}

export async function deleteList(listId: string): Promise<void> {
  done(await api.DELETE('/v1/todos/lists/{listId}', { params: { path: { listId } } }));
}

export async function orderTodos(listId: string, todoIds: string[]): Promise<void> {
  done(await api.PUT('/v1/todos/lists/{listId}/order', { params: { path: { listId } }, body: { todoIds } }));
}

// --- what I'm looking at: all lists or one, and open or completed ---

export type TodoFilter = { listId: string | null; completed: boolean };

export const ALL_TODOS: TodoFilter = { listId: null, completed: false };

/** The list picker's label: "All", or the list's name. Pure. */
export function listLabel(lists: Pick<TodoList, 'listId' | 'name'>[], listId: string | null): string {
  return (listId && lists.find((l) => l.listId === listId)?.name) || 'All';
}

/** One list's to-dos, or everyone's (All). Pure. */
export function inList(todos: Todo[], listId: string | null): Todo[] {
  return listId ? todos.filter((t) => t.listId === listId) : todos;
}

/** All: each list that has something, in my list order, its to-dos in my order. Pure. */
export function listSections(todos: Todo[], lists: Pick<TodoList, 'listId' | 'name'>[]): { listId: string; title: string; todos: Todo[] }[] {
  return lists.map((l) => ({ listId: l.listId, title: l.name, todos: todos.filter((t) => t.listId === l.listId) })).filter((s) => s.todos.length > 0);
}

// --- All as one list to drag in: each list's heading, then its to-dos ---

export type AllItem = { kind: 'list'; listId: string; title: string } | { kind: 'todo'; todo: Todo };

/** Every list's heading (empty ones too, to drop into), each followed by its to-dos in my order. Pure. */
export function allItems(todos: Todo[], lists: Pick<TodoList, 'listId' | 'name'>[]): AllItem[] {
  return lists.flatMap((l) => [
    { kind: 'list' as const, listId: l.listId, title: l.name },
    ...todos.filter((t) => t.listId === l.listId).map((todo) => ({ kind: 'todo' as const, todo })),
  ]);
}

/**
 * Where a to-do dragged in All lands: the list whose heading is above it (the first list if dropped above every
 * heading), and that list's new order. Pure.
 */
export function dropInAll(items: AllItem[], from: number, to: number): { todoId: string; listId: string; order: string[] } | null {
  const moved = items[from];
  if (!moved || moved.kind !== 'todo') return null;
  const next = [...items];
  next.splice(to, 0, ...next.splice(from, 1));
  const firstList = next.find((i) => i.kind === 'list');
  if (!firstList || firstList.kind !== 'list') return null;
  let listId: string = firstList.listId;
  const lists = new Map<string, string[]>();
  for (const item of next) {
    if (item.kind === 'list') listId = item.listId;
    else lists.set(listId, [...(lists.get(listId) ?? []), item.todo.todoId]);
  }
  // (Dropped above every heading, it counts as the first list's, at its top.)
  const [target, order] = [...lists.entries()].find(([, ids]) => ids.includes(moved.todo.todoId))!;
  return { todoId: moved.todo.todoId, listId: target, order };
}
