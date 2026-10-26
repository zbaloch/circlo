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

export type ProfileTab = 'posts' | 'media' | 'likes';

/** Tabs for a profile: Likes only on my own (PLAN.md 2A). */
export function profileTabs(own: boolean): ProfileTab[] {
  return own ? ['posts', 'media', 'likes'] : ['posts', 'media'];
}

/** Posts shown under each tab. Likes come from the timeline I've loaded (posts I can read and liked). */
export function postsForTab(tab: ProfileTab, authored: FeedPost[], timeline: FeedPost[]): FeedPost[] {
  if (tab === 'media') return authored.filter((p) => p.media.length > 0);
  if (tab === 'likes') return timeline.filter((p) => p.likedByMe);
  return authored;
}
