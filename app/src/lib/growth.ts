/**
 * Growth totals for Circlo's admins (GET /v1/admin/growth; owner request 2026-11-20): counts per day, never who.
 * Settings shows the page only when /v1/me says I'm an admin; the server answers 404 to anyone else.
 */
import { api, ok } from '@/api/client';
import type { paths } from '@/api/schema';

export type Growth = paths['/v1/admin/growth']['get']['responses']['200']['content']['application/json'];
export type GrowthDay = Growth['days'][number];
export type Metric = 'signups' | 'inviteJoins' | 'connections' | 'posts' | 'replies';

export const METRICS: { key: Metric; label: string; short: string }[] = [
  { key: 'signups', label: 'Sign-ups', short: 'Sign-ups' },
  { key: 'inviteJoins', label: 'Joined through an invite', short: 'Joins' },
  { key: 'connections', label: 'Connections made', short: 'Conn.' },
  { key: 'posts', label: 'Posts', short: 'Posts' },
  { key: 'replies', label: 'Replies', short: 'Replies' },
];

export async function fetchGrowth(): Promise<Growth> {
  return ok(await api.GET('/v1/admin/growth'));
}

/** Pure: a metric over the last 7 days (newest first, as the server sends them) and the 7 days before. */
export function lastTwoWeeks(days: GrowthDay[], key: Metric): { thisWeek: number; lastWeek: number } {
  const sum = (from: number) => days.slice(from, from + 7).reduce((n, d) => n + d[key], 0);
  return { thisWeek: sum(0), lastWeek: sum(7) };
}

/** Pure: how a week compares with the one before: "+3", "−2", "same". */
export function change(thisWeek: number, lastWeek: number): string {
  const d = thisWeek - lastWeek;
  return d === 0 ? 'same' : d > 0 ? `+${d}` : `−${-d}`;
}

/** Pure: "20 Nov" for a UTC date like 2026-11-20. */
export function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
