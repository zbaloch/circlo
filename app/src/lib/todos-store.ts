import { useSyncExternalStore } from 'react';

import {
  addList as apiAddList,
  addTodo,
  completeTodo,
  deleteList as apiDeleteList,
  deleteTodo,
  loadTodos,
  orderTodos,
  renameList as apiRenameList,
  reopenTodo,
  saveTodo,
  todayIso,
  type Todo,
  type TodoFields,
  type TodoList,
} from '@/lib/todos';

/**
 * My lists and open to-dos, shared by the Todos screens. Changes show straight away and go to the server behind
 * them; if the server says no, the change is undone and the caller hears about it (to say so).
 */
export type TodosState = { lists: TodoList[]; todos: Todo[]; loaded: boolean };

const EMPTY: TodosState = { lists: [], todos: [], loaded: false };
let state: TodosState = EMPTY;
const listeners = new Set<() => void>();

function set(next: Partial<TodosState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTodos(): TodosState {
  return state;
}

export function useTodos(): TodosState {
  return useSyncExternalStore(subscribe, getTodos, getTodos);
}

/** Forgets everything (sign-out). */
export function clearTodos(): void {
  set(EMPTY);
}

export async function refreshTodos(): Promise<void> {
  const { lists, todos } = await loadTodos();
  set({ lists, todos, loaded: true });
}

function replace(todoId: string, todo: Todo | null) {
  set({ todos: todo ? state.todos.map((t) => (t.todoId === todoId ? todo : t)) : state.todos.filter((t) => t.todoId !== todoId) });
}

/** Adds a to-do at the end of its list (General when no list is given). */
export async function addTodoNow(fields: TodoFields): Promise<Todo> {
  const general = state.lists.find((l) => l.general)?.listId ?? '';
  const temp: Todo = {
    todoId: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    listId: fields.listId ?? general,
    title: fields.title,
    notes: fields.notes,
    dueDate: fields.dueDate,
    repeat: fields.repeat,
    completedAt: null,
    createdAt: new Date().toISOString(),
  };
  set({ todos: [...state.todos, temp] });
  try {
    const saved = await addTodo(fields);
    replace(temp.todoId, saved);
    return saved;
  } catch (e) {
    replace(temp.todoId, null);
    throw e;
  }
}

/** Saves a to-do as it is now; a new list puts it at that list's end. */
export async function saveTodoNow(todoId: string, fields: TodoFields): Promise<Todo> {
  const before = state.todos.find((t) => t.todoId === todoId);
  if (before) {
    const moved = fields.listId != null && fields.listId !== before.listId;
    const updated = { ...before, ...fields, listId: fields.listId ?? before.listId };
    set({ todos: moved ? [...state.todos.filter((t) => t.todoId !== todoId), updated] : state.todos.map((t) => (t.todoId === todoId ? updated : t)) });
  }
  try {
    const saved = await saveTodo(todoId, fields);
    replace(todoId, saved);
    return saved;
  } catch (e) {
    if (before) set({ todos: state.todos.map((t) => (t.todoId === todoId ? before : t)) });
    throw e;
  }
}

export async function deleteTodoNow(todoId: string): Promise<void> {
  const before = state.todos;
  set({ todos: state.todos.filter((t) => t.todoId !== todoId) });
  try {
    await deleteTodo(todoId);
  } catch (e) {
    set({ todos: before });
    throw e;
  }
}

/** Ticks a to-do; a repeating one comes back with its next date, in the same place. */
export async function completeTodoNow(todoId: string, today = todayIso()): Promise<void> {
  const before = state.todos;
  const index = before.findIndex((t) => t.todoId === todoId);
  set({ todos: before.filter((t) => t.todoId !== todoId) });
  try {
    const { next } = await completeTodo(todoId, today);
    if (next) {
      const todos = [...state.todos];
      todos.splice(Math.min(Math.max(index, 0), todos.length), 0, next);
      set({ todos });
    }
  } catch (e) {
    set({ todos: before });
    throw e;
  }
}

/** Unticks a to-do from Completed: it goes back to the end of its list. */
export async function reopenTodoNow(todoId: string): Promise<Todo> {
  const reopened = await reopenTodo(todoId);
  set({ todos: [...state.todos.filter((t) => t.todoId !== todoId), reopened] });
  return reopened;
}

/** A list's open to-dos in a new order. */
export async function reorderTodosNow(listId: string, ordered: string[]): Promise<void> {
  const before = state.todos;
  const rank = new Map(ordered.map((id, i) => [id, i]));
  const inList = before.filter((t) => t.listId === listId).sort((a, b) => (rank.get(a.todoId) ?? 0) - (rank.get(b.todoId) ?? 0));
  let i = 0;
  set({ todos: before.map((t) => (t.listId === listId ? inList[i++] : t)) });
  try {
    await orderTodos(listId, ordered);
  } catch (e) {
    set({ todos: before });
    throw e;
  }
}

export async function addListNow(name: string): Promise<TodoList> {
  const list = await apiAddList(name);
  set({ lists: [...state.lists, list] });
  return list;
}

export async function renameListNow(listId: string, name: string): Promise<void> {
  const list = await apiRenameList(listId, name);
  set({ lists: state.lists.map((l) => (l.listId === listId ? list : l)) });
}

/** Deletes a list and its to-dos (not General). */
export async function deleteListNow(listId: string): Promise<void> {
  await apiDeleteList(listId);
  set({ lists: state.lists.filter((l) => l.listId !== listId), todos: state.todos.filter((t) => t.listId !== listId) });
}
