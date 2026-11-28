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

function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last)));
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


// --- quick add: dates and repeats in words ---

export type QuickAdd = { title: string; dueDate: string | null; repeat: Repeat | null; phrase: string | null };

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const WD = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|');
const MON = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const NUM = `\\d{1,3}|${Object.keys(NUMBERS).join('|')}`;
const LEAD = '(?:(?:on|by|due)\\s+)?';

/** The weekday on or after today. */
function onOrAfter(today: string, day: number): string {
  return addDays(today, (day - weekday(today) + 7) % 7);
}

function validDate(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** A month and day: this year's, or next year's once it has passed. */
function monthDay(today: string, m: number, d: number, year?: number): string | null {
  const y = year ?? Number(today.slice(0, 4));
  if (!validDate(y, m, d)) return null;
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (year === undefined && iso < today) return validDate(y + 1, m, d) ? `${y + 1}${iso.slice(4)}` : null;
  return iso;
}

type Found = { start: number; end: number; date?: string; repeat?: Repeat };

function dates(text: string, today: string): Found[] {
  const out: Found[] = [];
  const scan = (pattern: string, read: (m: RegExpExecArray) => Omit<Found, 'start' | 'end'> | null) => {
    const re = new RegExp(`\\b${pattern}\\b`, 'gi');
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const r = read(m);
      if (r) out.push({ start: m.index, end: m.index + m[0].length, ...r });
    }
  };
  // Repeats ("every Monday", "every month", "daily"): from the next such day, or today.
  scan(`(?:every|each)\\s+(${WD})`, (m) => ({ repeat: 'weekly', date: onOrAfter(today, WEEKDAYS[m[1].toLowerCase()]) }));
  scan('(?:every|each)\\s+(day|week|month)', (m) => ({ repeat: ({ day: 'daily', week: 'weekly', month: 'monthly' } as const)[m[1].toLowerCase() as 'day'] }));
  scan('(daily|weekly|monthly)', (m) => ({ repeat: m[1].toLowerCase() as Repeat }));
  // Dates
  scan(`${LEAD}(today|tonight)`, () => ({ date: today }));
  scan(`${LEAD}(tomorrow|tmrw|tmr)`, () => ({ date: addDays(today, 1) }));
  scan(`${LEAD}next\\s+week`, () => ({ date: addDays(today, ((8 - weekday(today)) % 7) || 7) }));
  scan(`${LEAD}next\\s+month`, () => ({ date: addMonths(`${today.slice(0, 8)}01`, 1) }));
  scan(`${LEAD}(?:this\\s+)?weekend`, () => ({ date: onOrAfter(today, 6) }));
  scan(`${LEAD}(?:(next|this)\\s+)?(${WD})`, (m) => {
    const day = WEEKDAYS[m[2].toLowerCase()];
    const date = onOrAfter(today, day);
    return { date: m[1]?.toLowerCase() === 'next' && date === today ? addDays(today, 7) : date };
  });
  scan(`in\\s+(${NUM})\\s+(days?|weeks?|months?)`, (m) => {
    const n = NUMBERS[m[1].toLowerCase()] ?? Number(m[1]);
    const unit = m[2].toLowerCase();
    if (!(n > 0 && n <= 366)) return null;
    return { date: unit.startsWith('day') ? addDays(today, n) : unit.startsWith('week') ? addDays(today, 7 * n) : addMonths(today, n) };
  });
  scan(`${LEAD}(${MON})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, (m) => {
    const date = monthDay(today, MONTHS[m[1].toLowerCase()], Number(m[2]), m[3] ? Number(m[3]) : undefined);
    return date ? { date } : null;
  });
  scan(`${LEAD}(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON})\\.?(?:\\s+(\\d{4}))?`, (m) => {
    const date = monthDay(today, MONTHS[m[2].toLowerCase()], Number(m[1]), m[3] ? Number(m[3]) : undefined);
    return date ? { date } : null;
  });
  return out;
}

/**
 * Reads a date and a repeat from what I typed ("Call mum tomorrow", "Pay rent every month", "Dentist next Fri",
 * "Taxes in 2 weeks", "Party Dec 5") and takes those words out of the title. The last date and repeat win; when
 * nothing would be left of the title, the words stay as they are. {@code ignore}: a phrase I tapped away. Pure.
 */
export function parseQuickAdd(text: string, today: string, ignore?: string | null): QuickAdd {
  const all = dates(text, today).filter((f) => text.slice(f.start, f.end).toLowerCase() !== ignore?.toLowerCase());
  // A longer phrase wins over one inside it ("every Monday" over "Monday"; "next Fri" over "Fri").
  const found = all.filter((f) => !all.some((g) => g !== f && g.start <= f.start && g.end >= f.end && g.end - g.start > f.end - f.start));
  const repeatAt = [...found].reverse().find((f) => f.repeat);
  const dateAt = [...found].reverse().find((f) => f.date && !f.repeat) ?? (repeatAt?.date ? repeatAt : undefined);
  const used = [repeatAt, dateAt].filter((f, i, a): f is Found => !!f && a.indexOf(f) === i).sort((a, b) => b.start - a.start);
  if (used.length === 0) return { title: text.trim(), dueDate: null, repeat: null, phrase: null };
  let title = text;
  for (const f of used) title = title.slice(0, f.start) + ' ' + title.slice(f.end);
  title = title.replace(/\s+/g, ' ').trim().replace(/\s+([,.;:!?])/g, '$1').replace(/^[,.;:\s]+|[,;:\s]+$/g, '');
  if (!title) return { title: text.trim(), dueDate: null, repeat: null, phrase: null };
  const repeat = repeatAt?.repeat ?? null;
  const dueDate = dateAt?.date ?? (repeat ? today : null);
  const phrase = used
    .sort((a, b) => a.start - b.start)
    .map((f) => text.slice(f.start, f.end).trim())
    .join(' ');
  return { title, dueDate, repeat, phrase };
}

/** What quick add will set, in words for its chip: "Tomorrow", "Friday · Every week". Pure. */
export function quickAddLabel(q: Pick<QuickAdd, 'dueDate' | 'repeat'>, today: string): string | null {
  const parts = [q.dueDate ? dayLabel(q.dueDate, today) : null, q.repeat ? repeatLabel(q.repeat) : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** A date (and repeat) typed on its own, in the same words quick add reads ("fri", "dec 5", "in 2 weeks"). Pure. */
export function parseDateWords(text: string, today: string): { dueDate: string; repeat: Repeat | null } | null {
  const r = parseQuickAdd(`• ${text}`, today);
  return r.dueDate && r.title === '•' ? { dueDate: r.dueDate, repeat: r.repeat } : null;
}
