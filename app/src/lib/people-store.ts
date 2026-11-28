import { useSyncExternalStore } from 'react';

import { api, ok } from '@/api/client';

import {
  addPerson,
  byName,
  deletePerson,
  linkPerson,
  loadPeople,
  personKey,
  savePerson,
  unlinkPerson,
  type Contact,
  type ContactFields,
  type ContactNote,
} from './people';
import { cancelPeopleReminders, schedulePeopleReminders } from './people-reminders';

/**
 * Everyone in the Rolodex, shared by its page, a person's screen and a friend's profile. Saves show straight away
 * and go to the server behind them; if it says no, the change is undone and the caller hears about it. Every change
 * reschedules the phone's reminders.
 */
export type PeopleState = { people: Contact[]; loaded: boolean };

const EMPTY: PeopleState = { people: [], loaded: false };
let state: PeopleState = EMPTY;
const listeners = new Set<() => void>();
let remindTimer: ReturnType<typeof setTimeout> | null = null;

function set(next: Partial<PeopleState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
  if (state.loaded) {
    if (remindTimer) clearTimeout(remindTimer);
    remindTimer = setTimeout(() => void schedulePeopleReminders(state.people).catch(() => undefined), 1000);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPeople(): PeopleState {
  return state;
}

export function usePeople(): PeopleState {
  return useSyncExternalStore(subscribe, getPeople, getPeople);
}

/** Forgets everything and cancels the reminders (sign-out). */
export async function clearPeople(): Promise<void> {
  if (remindTimer) clearTimeout(remindTimer);
  remindTimer = null;
  state = EMPTY;
  listeners.forEach((l) => l());
  await cancelPeopleReminders().catch(() => undefined);
}

export async function refreshPeople(): Promise<void> {
  set({ people: await loadPeople(), loaded: true });
}

/** The person with this key (an entry id, or `u-<userId>` for a connection), if they're in People. */
export function findPerson(people: Contact[], key: string): Contact | undefined {
  return people.find((c) => personKey(c) === key || c.contactId === key || (key.startsWith('u-') && c.person?.userId === key.slice(2)));
}

function replace(key: string, next: Contact | null) {
  const rest = state.people.filter((c) => personKey(c) !== key && (!next?.contactId || c.contactId !== next.contactId));
  set({ people: byName(next ? [...rest, next] : rest) });
}

/** Adds someone by name (not on Circlo). */
export async function addPersonNow(name: string): Promise<Contact> {
  const made = await addPerson(name);
  replace(personKey(made), made);
  return made;
}

/**
 * The entry for this person, made the first time I write about a connection. Returns it with its contactId; the
 * connection's row becomes the entry.
 */
export async function entryFor(c: Contact): Promise<Contact> {
  if (c.contactId) return c;
  const made = await addPerson(c.name, c.person!.userId);
  replace(personKey(c), made);
  return made;
}

/** Saves name, rhythm and dates. */
export async function savePersonNow(c: Contact, fields: ContactFields): Promise<Contact> {
  const entry = await entryFor(c);
  const before = entry;
  replace(entry.contactId!, { ...entry, ...fields });
  try {
    const saved = await savePerson(entry.contactId!, fields);
    replace(entry.contactId!, saved);
    return saved;
  } catch (e) {
    replace(entry.contactId!, before);
    throw e;
  }
}

/** Deletes an entry and its notes; a connection comes back as one I haven't written about. */
export async function deletePersonNow(contactId: string): Promise<void> {
  const before = state.people;
  const gone = before.find((c) => c.contactId === contactId);
  set({ people: before.filter((c) => c.contactId !== contactId) });
  try {
    await deletePerson(contactId);
    if (gone?.person) await refreshPeople();
  } catch (e) {
    set({ people: before });
    throw e;
  }
}

export async function linkPersonNow(contactId: string, userId: string): Promise<Contact> {
  const linked = await linkPerson(contactId, userId);
  // The connection's own row is now this entry.
  set({ people: byName([...state.people.filter((c) => c.contactId !== contactId && !(c.contactId === null && c.person?.userId === userId)), linked]) });
  return linked;
}

export async function unlinkPersonNow(contactId: string): Promise<void> {
  await unlinkPerson(contactId);
  await refreshPeople();
}

/** After a note or catch-up was added: its count, and when we last caught up. */
export function noteAdded(contactId: string, note: ContactNote): void {
  set({
    people: state.people.map((c) =>
      c.contactId !== contactId
        ? c
        : {
            ...c,
            noteCount: c.noteCount + 1,
            lastCaughtUp: note.caughtUp && (!c.lastCaughtUp || note.at > c.lastCaughtUp) ? note.at : c.lastCaughtUp,
          },
    ),
  });
}

/** After a note was deleted: the entry as the server now has it (the last catch-up may be an earlier one). */
export async function noteDeleted(contactId: string): Promise<void> {
  const fresh = ok(await api.GET('/v1/contacts/{contactId}', { params: { path: { contactId } } }));
  replace(contactId, fresh);
}
