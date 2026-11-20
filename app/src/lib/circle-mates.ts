/**
 * People in the same circle see each other (owner decision 2026-11-20). On a friend's profile I see the others who
 * share one of their circles with me, as one list, never which circle; I can ask any of them to connect. Each owner
 * switches it on or off per circle (Family and Close Friends start on), and anyone can hide themselves in Privacy and
 * safety. The server decides who is listed.
 */
import { api, ok } from '@/api/client';
import type { components } from '@/api/schema';
import { getItem, setItem } from '@/lib/storage';

export type CircleMate = components['schemas']['CircleMate'];

/** The people I see on this friend's profile (empty on my own). */
export async function loadCircleMates(ownerId: string): Promise<CircleMate[]> {
  return ok(await api.GET('/v1/users/{userId}/circle-mates', { params: { path: { userId: ownerId } } }));
}

/** The people this friend sees on my profile ("See what they can see"). */
export async function previewCircleMates(friendId: string): Promise<CircleMate[]> {
  return ok(await api.GET('/v1/me/preview/{friendId}/circle-mates', { params: { path: { friendId } } }));
}

/** "Imran", "Imran and Zulfi", "Imran, Zulfi and 2 others". Pure. */
export function matesLine(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} and ${rest} ${rest === 1 ? 'other' : 'others'}`;
}

/** What switching "People in this circle can see each other" on or off means, for its confirmation and toast. Pure. */
export function membersVisibleChange(circle: string, people: number, on: boolean) {
  const who = people === 1 ? `The person in ${circle}` : `The ${people} people in ${circle}`;
  return on
    ? {
        title: `Let ${circle} see each other?`,
        message: `${who} will see each other on your profile and can ask each other to connect. They never see the circle’s name, and nobody is told you changed this. People who hide themselves in their settings aren’t shown.`,
        confirm: 'Turn on',
        done: `People in ${circle} can see each other now`,
      }
    : {
        title: `Stop ${circle} seeing each other?`,
        message: `People in ${circle} will no longer see each other on your profile. Anyone who already connected stays connected, and nobody is told you changed this.`,
        confirm: 'Turn off',
        done: `People in ${circle} can’t see each other now`,
      };
}

/** Home's "People you may know": one friend and the people I may know through them (not connected with yet). */
export type MayKnowGroup = { owner: Person; people: Person[] };
type Person = components['schemas']['Person'];

export async function loadPeopleYouMayKnow(): Promise<MayKnowGroup[]> {
  return ok(await api.GET('/v1/me/people-you-may-know'));
}

/**
 * Pure: whether Home shows the card. Closing it remembers who was in it (on this device only); it comes back when
 * someone new is listed.
 */
export function showMayKnow(groups: MayKnowGroup[], dismissed: ReadonlySet<string>): boolean {
  return groups.some((g) => g.people.some((p) => !dismissed.has(p.userId)));
}

const dismissedKey = (userId: string) => `circlo.may-know-dismissed.${userId}`;

/** The people shown when the card was last closed on this device. */
export async function dismissedMayKnow(userId: string): Promise<Set<string>> {
  try {
    const raw = await getItem(dismissedKey(userId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** Closes the card until someone new is listed. Kept to the last 500 people. */
export async function dismissMayKnow(userId: string, groups: MayKnowGroup[], before: ReadonlySet<string>): Promise<Set<string>> {
  const all = new Set([...before, ...groups.flatMap((g) => g.people.map((p) => p.userId))]);
  const kept = [...all].slice(-500);
  await setItem(dismissedKey(userId), JSON.stringify(kept)).catch(() => undefined);
  return new Set(kept);
}
