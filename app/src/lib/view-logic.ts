/** Pure display helpers for posts, threads and profiles (no React, no native modules; unit-tested). */
import type { FeedPost } from './posts';

const URL = /(https?:\/\/[^\s]+)/g;

/** Splits text into plain and link parts. Only http(s) links are linkified; trailing punctuation stays text. */
export function linkParts(text: string): { text: string; url?: string }[] {
  return text
    .split(URL)
    .filter(Boolean)
    .map((part) => (/^https?:\/\//.test(part) ? { text: part, url: part.replace(/[.,!?)]+$/, '') } : { text: part }));
}

/** "Liked by Ana, Sam and 3 others": names only for people I know; everyone else is counted. */
export function likersLine(names: string[], others: number): string | null {
  const total = names.length + others;
  if (total === 0) return null;
  const shown = names.slice(0, 2);
  const rest = total - shown.length;
  if (shown.length === 0) return `Liked by ${total} ${total === 1 ? 'person' : 'people'}`;
  return `Liked by ${shown.join(rest ? ', ' : ' and ')}${rest ? ` and ${rest} ${rest === 1 ? 'other' : 'others'}` : ''}`;
}

export type ProfileTab = 'posts' | 'replies' | 'media' | 'likes';

/** Tabs for a profile, as on X: Posts, Replies, Media, and Likes only on my own (PLAN.md 2A). */
export function profileTabs(own: boolean): ProfileTab[] {
  return own ? ['posts', 'replies', 'media', 'likes'] : ['posts', 'replies', 'media'];
}

/** Posts shown under each tab. Likes come from the timeline I've loaded (posts I can read and liked). */
export function postsForTab(tab: ProfileTab, authored: FeedPost[], timeline: FeedPost[]): FeedPost[] {
  if (tab === 'media') return authored.filter((p) => p.media.length > 0);
  if (tab === 'likes') return timeline.filter((p) => p.likedByMe);
  if (tab === 'replies') return [];
  return authored;
}

/** Chat title from member names: "Bob", "Bob and Carol", "Bob, Carol and 2 others". */
export function chatTitle(names: string[]): string {
  if (names.length === 0) return 'Just you';
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} ${names.length - 2 === 1 ? 'other' : 'others'}`;
}

/** Date separator label: "Today", "Yesterday", or a short date. */
export function dayLabel(ms: number, now = Date.now()): string {
  const day = (t: number) => new Date(t).toDateString();
  if (day(ms) === day(now)) return 'Today';
  if (day(ms) === day(now - 86_400_000)) return 'Yesterday';
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}
