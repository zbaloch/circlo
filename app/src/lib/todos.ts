/**
 * Todos (2.0; owner decision 2026-11-27): personal to-do lists, Things' calm with Todoist's quick add. Only I ever see
 * them (the server answers anyone else with 404). Dates are calendar dates ("2026-11-28") in my phone's calendar; no
 * times, no reminders, no badges.
 */
import { api, ok } from '@/api/client';
import type { components } from '@/api/schema';

export type TodoList = components['schemas']['TodoList'];
export type Todo = components['schemas']['Todo'];
export type Repeat = 'daily' | 'weekly' | 'monthly';
export type TodoFields = { title: string; notes: string | null; dueDate: string | null; repeat: Repeat | null; listId: string | null };

// --- the API ---

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
  ok(await api.DELETE('/v1/todos/{todoId}', { params: { path: { todoId } } }));
}

export async function completeTodo(todoId: string, today: string): Promise<{ completed: Todo; next: Todo | null }> {
  return ok(await api.POST('/v1/todos/{todoId}/complete', { params: { path: { todoId } }, body: { today } }));
}

export async function reopenTodo(todoId: string): Promise<Todo> {
  return ok(await api.POST('/v1/todos/{todoId}/reopen', { params: { path: { todoId } } }));
}

/** Completed to-dos (the last 30 days'), newest first: one list's, or all of them. */
export async function loadCompleted(listId: string | null): Promise<Todo[]> {
  if (!listId) return ok(await api.GET('/v1/todos/completed'));
  return ok(await api.GET('/v1/todos/lists/{listId}/completed', { params: { path: { listId } } }));
}

export async function addList(name: string): Promise<TodoList> {
  return ok(await api.POST('/v1/todos/lists', { body: { name } }));
}

export async function renameList(listId: string, name: string): Promise<TodoList> {
  return ok(await api.PUT('/v1/todos/lists/{listId}', { params: { path: { listId } }, body: { name } }));
}

export async function deleteList(listId: string): Promise<void> {
  ok(await api.DELETE('/v1/todos/lists/{listId}', { params: { path: { listId } } }));
}

export async function orderTodos(listId: string, todoIds: string[]): Promise<void> {
  ok(await api.PUT('/v1/todos/lists/{listId}/order', { params: { path: { listId } }, body: { todoIds } }));
}

// --- calendar dates ("2026-11-28"), in my phone's calendar ---

const DAY_MS = 86_400_000;

function toUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today in my phone's calendar. */
export function todayIso(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(iso: string): number {
  return new Date(toUtc(iso)).getUTCDay();
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Today", "Tomorrow", "Yesterday", "Friday" (within the week ahead), "5 Dec", "5 Dec 2027". */
export function dayLabel(iso: string, today: string): string {
  const days = daysBetween(today, iso);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1 && days < 7) return WEEKDAY_NAMES[weekday(iso)];
  const [y, m, d] = iso.split('-').map(Number);
  const month = MONTH_NAMES[m - 1].slice(0, 3);
  return y === Number(today.slice(0, 4)) ? `${d} ${month}` : `${d} ${month} ${y}`;
}

export function repeatLabel(repeat: Repeat): string {
  return { daily: 'Every day', weekly: 'Every week', monthly: 'Every month' }[repeat];
}

// --- what I'm looking at: all lists or one, and optionally only Today, Upcoming, No date or Completed ---

export type When = 'today' | 'upcoming' | 'nodate' | 'completed';
export type TodoFilter = { listId: string | null; when: When | null };

export const ALL_TODOS: TodoFilter = { listId: null, when: null };

export const WHEN: { value: When; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'nodate', label: 'No date' },
  { value: 'completed', label: 'Completed' },
];

/** The list picker's label: "All", or the list's name. Pure. */
export function listLabel(lists: Pick<TodoList, 'listId' | 'name'>[], listId: string | null): string {
  return (listId && lists.find((l) => l.listId === listId)?.name) || 'All';
}

/** One list's to-dos, or everyone's (All). Pure. */
export function inList(todos: Todo[], listId: string | null): Todo[] {
  return listId ? todos.filter((t) => t.listId === listId) : todos;
}

/** All, with no "when": each list that has something, in my list order, its to-dos in my order. Pure. */
export function listSections(todos: Todo[], lists: Pick<TodoList, 'listId' | 'name'>[]): { listId: string; title: string; todos: Todo[] }[] {
  return lists.map((l) => ({ listId: l.listId, title: l.name, todos: todos.filter((t) => t.listId === l.listId) })).filter((s) => s.todos.length > 0);
}

/** Today's view: overdue first (oldest first), then today's, each in list order. */
export function todayTodos(todos: Todo[], today: string): Todo[] {
  return todos.filter((t) => t.dueDate && t.dueDate <= today).sort(byDate(todos));
}

function byDate(order: Todo[]) {
  const rank = new Map(order.map((t, i) => [t.todoId, i]));
  return (a: Todo, b: Todo) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || (rank.get(a.todoId) ?? 0) - (rank.get(b.todoId) ?? 0);
}

/** Upcoming, grouped: each of the next six days by name, then by month. */
export function upcomingGroups(todos: Todo[], today: string): { title: string; todos: Todo[] }[] {
  const later = todos.filter((t) => t.dueDate && t.dueDate > today).sort(byDate(todos));
  const groups: { title: string; todos: Todo[] }[] = [];
  for (const t of later) {
    const days = daysBetween(today, t.dueDate!);
    const [y, m] = t.dueDate!.split('-').map(Number);
    const title =
      days < 7 ? dayLabel(t.dueDate!, today) : `${MONTH_NAMES[m - 1]}${y === Number(today.slice(0, 4)) ? '' : ` ${y}`}`;
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.todos.push(t);
    else groups.push({ title, todos: [t] });
  }
  return groups;
}

export function noDateTodos(todos: Todo[]): Todo[] {
  return todos.filter((t) => !t.dueDate);
}


// --- picking a day: shortcuts and a month calendar ---

/** Next week: the coming Monday (a week on if today is Monday). Pure. */
export function nextWeek(today: string): string {
  return addDays(today, ((8 - weekday(today)) % 7) || 7);
}

/** The month a date is in ("2026-11"), and the one {@code by} months on. Pure. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/** "December", or "January 2027" outside this year. Pure. */
export function monthTitle(month: string, today: string): string {
  const [y, m] = month.split('-').map(Number);
  return y === Number(today.slice(0, 4)) ? MONTH_NAMES[m - 1] : `${MONTH_NAMES[m - 1]} ${y}`;
}

export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** A month's days as weeks, Monday first; the days before the 1st and after the last are null. Pure. */
export function monthWeeks(month: string): (string | null)[][] {
  const first = `${month}-01`;
  const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const lead = (weekday(first) + 6) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => addDays(first, i))];
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** "Friday 5 December 2026", for screen readers. Pure. */
export function fullDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAY_NAMES[weekday(iso)]} ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}
