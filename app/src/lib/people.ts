/**
 * The Rolodex, my personal CRM (owner decisions 2026-11-28; `contacts` in the API, `people` in the app's code): everyone I'm connected to plus anyone I
 * add, on Circlo or not, with days to remember, a keep-in-touch rhythm and a dated log of notes and catch-ups. Only I
 * ever see it (the server answers anyone else with 404, and the person is never told). Reminders are scheduled on the
 * phone (`people-reminders`), so the server keeps no reminder times or time zones.
 */
import { api, ok } from '@/api/client';
import type { components } from '@/api/schema';

export type Contact = components['schemas']['Contact'];
export type ContactDate = components['schemas']['ContactDate'];
export type ContactNote = components['schemas']['ContactNote'];
export type ContactFields = { name: string; keepInTouchDays: number | null; dates: ContactDate[] };

/** The feature's name, everywhere it's shown (owner 2026-11-28: "Rolodex", a trademark used as a plain noun; one place to rename it). */
export const ROLODEX = 'Rolodex';

/** The rhythms on offer, in days. */
export const RHYTHMS = [7, 14, 30, 90, 180, 365] as const;

/** How far ahead dates show in Coming up and on a row. */
export const SOON_DAYS = 14;
/** iOS keeps at most 64 scheduled notifications for an app; these leave room for the rest of Circlo's. */
export const MAX_REMINDERS = 50;
/** Reminders come at 9 in the morning. */
export const REMINDER_HOUR = 9;

// --- the API ---

/** For calls the server answers with 204 No Content: fine when it says so, an ApiError otherwise. */
function done(res: { data?: unknown; error?: unknown; response: Response }): void {
  if (!res.response.ok) ok(res);
}

export async function loadPeople(): Promise<Contact[]> {
  return ok(await api.GET('/v1/contacts')).people;
}

/** A new entry: someone by name, or (with userId) about a connection. */
export async function addPerson(name: string, userId?: string): Promise<Contact> {
  return ok(await api.POST('/v1/contacts', { body: { name, userId: userId ?? null } }));
}

export async function savePerson(contactId: string, fields: ContactFields): Promise<Contact> {
  // The server takes only the offered rhythms (400 otherwise); entries only ever hold those.
  const keepInTouchDays = fields.keepInTouchDays as (typeof RHYTHMS)[number] | null;
  return ok(await api.PUT('/v1/contacts/{contactId}', { params: { path: { contactId } }, body: { ...fields, keepInTouchDays } }));
}

export async function deletePerson(contactId: string): Promise<void> {
  done(await api.DELETE('/v1/contacts/{contactId}', { params: { path: { contactId } } }));
}

export async function linkPerson(contactId: string, userId: string): Promise<Contact> {
  return ok(await api.PUT('/v1/contacts/{contactId}/link', { params: { path: { contactId } }, body: { userId } }));
}

export async function unlinkPerson(contactId: string): Promise<void> {
  done(await api.DELETE('/v1/contacts/{contactId}/link', { params: { path: { contactId } } }));
}

export async function loadPersonNotes(contactId: string): Promise<ContactNote[]> {
  return ok(await api.GET('/v1/contacts/{contactId}/notes', { params: { path: { contactId } } }));
}

/** A note, or a catch-up (`caughtUp`, words optional, `at` an earlier day as YYYY-MM-DD). */
export async function addPersonNote(contactId: string, note: { body?: string; caughtUp?: boolean; at?: string }): Promise<ContactNote> {
  return ok(await api.POST('/v1/contacts/{contactId}/notes', { params: { path: { contactId } }, body: note }));
}

export async function deletePersonNote(contactId: string, noteId: string): Promise<void> {
  done(await api.DELETE('/v1/contacts/{contactId}/notes/{noteId}', { params: { path: { contactId, noteId } } }));
}

// --- pure: who, when ---

/** A person's key in routes: their entry, or `u-<userId>` for a connection I haven't written about. */
export function personKey(c: Contact): string {
  return c.contactId ?? `u-${c.person?.userId ?? ''}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar days from a to b (negative when b is earlier). */
function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function onYear(d: { month: number; day: number }, year: number): Date {
  const day = d.month === 2 && d.day === 29 && !isLeap(year) ? 28 : d.day;
  return new Date(year, d.month - 1, day);
}

/** The next day a date falls on (today counts), at midnight. 29 February is the 28th in other years. */
export function nextOccurrence(d: { month: number; day: number }, today: Date): Date {
  const start = startOfDay(today);
  const thisYear = onYear(d, start.getFullYear());
  return thisYear < start ? onYear(d, start.getFullYear() + 1) : thisYear;
}

/** "today", "tomorrow", "Tuesday" (within the week), else "in 12 days". */
function when(inDays: number, date: Date): string {
  if (inDays === 0) return 'today';
  if (inDays === 1) return 'tomorrow';
  if (inDays < 7) return WEEKDAYS[date.getDay()];
  return `in ${inDays} days`;
}

const isBirthday = (d: ContactDate) => d.label.trim().toLowerCase() === 'birthday';

/** Under a date on a person's screen: "14 March · turns 66 in 106 days", "2 December · Wednesday". */
export function dateLine(d: ContactDate, today: Date): string {
  const next = nextOccurrence(d, today);
  const inDays = daysBetween(today, next);
  const w = when(inDays, next);
  const day = `${d.day} ${MONTHS[d.month - 1]}`;
  if (d.year) {
    const years = next.getFullYear() - d.year;
    if (isBirthday(d)) return `${day} · ${inDays === 0 ? `${years} today` : `turns ${years} ${w}`}`;
    return `${day} · ${years} ${years === 1 ? 'year' : 'years'} ${w}`;
  }
  return `${day} · ${w.charAt(0).toUpperCase()}${w.slice(1)}`;
}

/** Days until I'm due to catch up (0 today, negative when overdue), or null without a rhythm. */
export function dueInDays(c: Contact, today: Date): number | null {
  const base = c.lastCaughtUp ?? c.keepSince;
  if (!c.keepInTouchDays || !base) return null;
  const due = startOfDay(new Date(base));
  due.setDate(due.getDate() + c.keepInTouchDays);
  return daysBetween(today, due);
}

export function rhythmLabel(days: number): string {
  return { 7: 'Every week', 14: 'Every 2 weeks', 30: 'Every month', 90: 'Every 3 months', 180: 'Every 6 months', 365: 'Every year' }[days] ?? `Every ${days} days`;
}

/** "a month", "2 weeks": how long a rhythm is, for "It’s been a month". */
function rhythmSpan(days: number): string {
  return { 7: 'a week', 14: '2 weeks', 30: 'a month', 90: '3 months', 180: '6 months', 365: 'a year' }[days] ?? `${days} days`;
}

/** "today", "yesterday", "5 days ago", "2 weeks ago", "3 months ago". */
export function agoText(iso: string, today: Date): string {
  const days = daysBetween(new Date(iso), today);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} ${days < 14 ? 'week' : 'weeks'} ago`;
  if (days < 365) return `${Math.floor(days / 30)} ${days < 60 ? 'month' : 'months'} ago`;
  return 'over a year ago';
}

/** A note's day: "Today", "Yesterday", "12 March", or "12 March 2025" in another year. */
export function noteDay(iso: string, today: Date): string {
  const d = new Date(iso);
  const ago = agoText(iso, today);
  if (ago === 'today') return 'Today';
  if (ago === 'yesterday') return 'Yesterday';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === today.getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}

/** A person's dates in the next `within` days, soonest first. */
function soonDates(c: Contact, today: Date, within = SOON_DAYS) {
  return c.dates
    .map((d) => {
      const next = nextOccurrence(d, today);
      return { d, next, inDays: daysBetween(today, next) };
    })
    .filter((x) => x.inDays <= within)
    .sort((a, b) => a.inDays - b.inDays);
}

export type ComingUp = { key: string; entry: Contact; text: string };

/** At the top of People: who's due a catch-up (most overdue first), then dates in the next two weeks. */
export function comingUp(people: Contact[], today: Date): ComingUp[] {
  const due = people
    .map((c) => ({ c, due: dueInDays(c, today) }))
    .filter((x): x is { c: Contact; due: number } => x.due !== null && x.due <= 0)
    .sort((a, b) => a.due - b.due)
    .map(({ c }) => ({ key: `${personKey(c)}:due`, entry: c, text: `Time to catch up (${rhythmLabel(c.keepInTouchDays!).toLowerCase()})` }));
  const dates = people
    .flatMap((c) => soonDates(c, today).map((x, i) => ({ c, ...x, i })))
    .sort((a, b) => a.inDays - b.inDays || a.c.name.localeCompare(b.c.name))
    .map(({ c, d, next, inDays, i }) => ({ key: `${personKey(c)}:date:${i}`, entry: c, text: `${d.label} ${when(inDays, next)}` }));
  return [...due, ...dates];
}

/** One quiet line under a person in the list: a date soon, a catch-up due, or when we last caught up. */
export function rowLine(c: Contact, today: Date): string {
  const soon = soonDates(c, today)[0];
  if (soon) return `${soon.d.label} ${when(soon.inDays, soon.next)}`;
  const due = dueInDays(c, today);
  if (due !== null && due <= 0) return 'Time to catch up';
  if (c.lastCaughtUp) return `Caught up ${agoText(c.lastCaughtUp, today)}`;
  return '';
}

export type Reminder = { id: string; date: Date; title: string; body: string; url: string };

/**
 * The local notifications to schedule, soonest first: each date's next day (within a year), and when each person
 * becomes due a catch-up, at 9 in the morning. Ones already past (today's after 9) are left out; overdue catch-ups
 * show in Coming up instead.
 */
export function reminders(people: Contact[], now: Date): Reminder[] {
  const at9 = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), REMINDER_HOUR);
  const out: Reminder[] = [];
  for (const c of people) {
    if (!c.contactId) continue;
    const url = `/rolodex/${c.contactId}`;
    c.dates.forEach((d, i) => {
      const date = at9(nextOccurrence(d, now));
      const years = d.year ? date.getFullYear() - d.year : null;
      const title = isBirthday(d) ? `${c.name}’s birthday` : `${c.name}: ${d.label}`;
      const body = years && isBirthday(d) ? `Turns ${years} today` : years ? `${years} ${years === 1 ? 'year' : 'years'} today` : 'Today';
      out.push({ id: `kit:${c.contactId}:date:${i}`, date, title, body, url });
    });
    const due = dueInDays(c, now);
    if (due !== null && due >= 0) {
      const date = at9(new Date(now.getFullYear(), now.getMonth(), now.getDate() + due));
      out.push({ id: `kit:${c.contactId}:due`, date, title: `Catch up with ${c.name}`, body: `It’s been ${rhythmSpan(c.keepInTouchDays!)}`, url });
    }
  }
  return out
    .filter((r) => r.date.getTime() > now.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, MAX_REMINDERS);
}

/** Sorted by name, as the server sends them; after a local change, the same order. */
export function byName(people: Contact[]): Contact[] {
  return [...people].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.name.localeCompare(b.name));
}
