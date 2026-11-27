/**
 * Feeds (2.0; called "reading" in code and the API, since /v1/feed is the Home timeline): web feeds (RSS, Atom) people
 * follow, blogs, newsletters, YouTube channels and podcasts alike. Circlo's server fetches each feed once for everyone
 * who follows it and sends titles, plain-text summaries and links; each item opens on its own site, in the in-app
 * browser. Only I can see what I follow. Nothing here is pushed: a quiet dot in the drawer says something new arrived.
 */
import { api, ok } from '@/api/client';
import type { components } from '@/api/schema';
import { describeError } from '@/lib/account';
import { relativeTime } from '@/lib/time';

export type Source = components['schemas']['ReadingSource'];
export type Article = components['schemas']['ReadingArticle'];
export type FoundSource = components['schemas']['FoundSource'];
export type ArticlePage = { articles: Article[]; next: string | null };
export type ContentBlock = components['schemas']['ContentBlock'];
export type ContentRun = components['schemas']['ContentRun'];
export type ArticleDetail = { article: Article; content: ContentBlock[] };

/** The words on the Feeds empty screen and in About: what it is, in plain words. */
export const READING_ABOUT =
  'Follow blogs, newsletters, YouTube channels and podcasts with web feeds (RSS). See what’s new here, and open anything on its own site.';

/** Which articles the list shows: all, only unread, or one source's. */
export type ReadingFilter = { kind: 'all' } | { kind: 'unread' } | { kind: 'source'; sourceId: string };

export async function loadSources(): Promise<Source[]> {
  return ok(await api.GET('/v1/reading/sources'));
}

export async function loadArticles(filter: ReadingFilter, before?: string | null): Promise<ArticlePage> {
  const query = {
    ...(filter.kind === 'unread' ? { unread: true } : {}),
    ...(filter.kind === 'source' ? { source: filter.sourceId } : {}),
    ...(before ? { before } : {}),
    limit: 30,
  };
  return ok(await api.GET('/v1/reading/articles', { params: { query } }));
}

/** One article with its content as blocks, for reading in Circlo. */
export async function loadArticle(articleId: string): Promise<ArticleDetail> {
  return ok(await api.GET('/v1/reading/articles/{articleId}', { params: { path: { articleId } } }));
}

export async function findSource(url: string): Promise<FoundSource> {
  return ok(await api.POST('/v1/reading/sources/find', { body: { url } }));
}

export async function followSource(url: string): Promise<Source> {
  return ok(await api.POST('/v1/reading/sources', { body: { url } }));
}

export async function unfollowSource(sourceId: string): Promise<void> {
  const res = await api.DELETE('/v1/reading/sources/{sourceId}', { params: { path: { sourceId } } });
  if (!res.response.ok) ok(res);
}

export async function setRead(articleId: string, read: boolean): Promise<void> {
  const opts = { params: { path: { articleId } } };
  const res = read ? await api.PUT('/v1/reading/articles/{articleId}/read', opts) : await api.DELETE('/v1/reading/articles/{articleId}/read', opts);
  if (!res.response.ok) ok(res);
}

export async function markAllRead(sourceId?: string): Promise<void> {
  const res = await api.POST('/v1/reading/read-all', { body: sourceId ? { sourceId } : {} });
  if (!res.response.ok) ok(res);
}

/** Whether the drawer shows its dot: something arrived since I last opened Feeds. */
export async function readingHasNew(): Promise<boolean> {
  return ok(await api.GET('/v1/reading/status')).hasNew;
}

/** I opened Feeds: the dot goes until something new arrives. */
export async function markReadingSeen(): Promise<void> {
  await api.PUT('/v1/reading/seen');
}

export async function importOpml(opml: string): Promise<{ added: number; skipped: number }> {
  return ok(await api.POST('/v1/reading/import', { body: { opml } }));
}

export async function exportOpml(): Promise<string> {
  const res = await api.GET('/v1/reading/export', { parseAs: 'text' });
  return ok(res as { data?: string; error?: unknown; response: Response });
}

// ---------- pure helpers ----------

/** "www.stratechery.com" → "stratechery.com". Pure. */
export function siteName(url: string | null | undefined): string {
  if (!url) return '';
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url);
  return (m?.[1] ?? '').replace(/^www\./i, '').toLowerCase();
}

/** The button at the end of an article: where it goes, in words. Pure. */
export function openOnSiteLabel(url: string): string {
  const site = siteName(url);
  if (site === 'youtube.com' || site === 'm.youtube.com' || site === 'youtu.be') return 'Watch on YouTube';
  return site ? `Read on ${site}` : 'Open the original';
}

/** An article image's signed Circlo path as a full address on this API. Pure. */
export function imageUri(src: string, apiUrl: string): string {
  return /^https?:\/\//i.test(src) ? src : `${apiUrl.replace(/\/$/, '')}${src}`;
}

/** A block's plain text (for its reading direction and font). Pure. */
export function blockText(runs: ContentRun[] | undefined): string {
  return (runs ?? []).map((r) => r.text).join('');
}

/** The quiet line under a source in Manage sources. Pure. */
export function sourceStatus(s: Pick<Source, 'updatedAt' | 'failingSince'>, now = Date.now()): string {
  if (s.failingSince) {
    const since = Date.parse(s.failingSince);
    const day = now - since < 7 * 86_400_000 ? new Date(since).toLocaleString('en', { weekday: 'long' }) : relativeTime(since, now);
    return now - since < 86_400_000 ? 'Couldn’t update just now' : `Couldn’t update since ${day}`;
  }
  if (!s.updatedAt) return 'Checking soon';
  const ago = relativeTime(Date.parse(s.updatedAt), now);
  return ago === 'now' ? 'Updated just now' : `Updated ${ago} ago`;
}

/** The chips above the list: All, Unread, then each source by name. Pure. */
export function filterChips(sources: Pick<Source, 'sourceId' | 'title'>[]): { key: string; label: string; filter: ReadingFilter }[] {
  return [
    { key: 'all', label: 'All', filter: { kind: 'all' } },
    { key: 'unread', label: 'Unread', filter: { kind: 'unread' } },
    ...sources.map((s) => ({ key: s.sourceId, label: s.title, filter: { kind: 'source', sourceId: s.sourceId } as ReadingFilter })),
  ];
}

/** The key of a filter's chip. Pure. */
export function filterKey(f: ReadingFilter): string {
  return f.kind === 'source' ? f.sourceId : f.kind;
}

/** How many unread articles a filter covers, from the sources' counts (kept current as I read). Pure. */
export function unreadIn(sources: Pick<Source, 'sourceId' | 'unread'>[], filter: ReadingFilter): number {
  const scope = filter.kind === 'source' ? sources.filter((s) => s.sourceId === filter.sourceId) : sources;
  return scope.reduce((n, s) => n + s.unread, 0);
}

/** A source's unread count after marking articles read (negative) or unread (positive); all of them with `null`. Pure. */
export function withUnread<T extends Pick<Source, 'sourceId' | 'unread'>>(sources: T[], sourceId: string | null, delta: number | 'none'): T[] {
  return sources.map((s) =>
    sourceId === null || s.sourceId === sourceId ? { ...s, unread: delta === 'none' ? 0 : Math.max(0, s.unread + delta) } : s,
  );
}

/** Merges a further page in, newest first, without repeats. Pure. */
export function mergeArticles(existing: Article[], page: Article[]): Article[] {
  const seen = new Set(existing.map((a) => a.articleId));
  return [...existing, ...page.filter((a) => !seen.has(a.articleId))];
}

/** One article marked read or unread. Pure. */
export function withRead(list: Article[], articleId: string, read: boolean): Article[] {
  return list.map((a) => (a.articleId === articleId ? { ...a, read } : a));
}

/** What went wrong, in words, for the add-a-source sheet. Pure. */
export function describeReadingError(e: unknown): string {
  switch ((e as { code?: string } | undefined)?.code) {
    case 'invalid_url':
      return 'That doesn’t look like a web address. Try something like example.com.';
    case 'no_feed':
      return 'We couldn’t find a feed on this site. Try the address of its blog or newsletter, or its RSS link.';
    case 'too_many_sources':
      return 'You can follow up to 200 sources. Unfollow one to add another.';
    case 'rate_limited':
      return 'That’s a lot of looking up for now. Try again in a little while.';
    default:
      return describeError(e);
  }
}

/** "3 added", "3 added · 1 couldn't be read". Pure. */
export function importSummary(r: { added: number; skipped: number }): string {
  const added = r.added === 0 ? 'Nothing new to add' : `${r.added} ${r.added === 1 ? 'source' : 'sources'} added`;
  return r.skipped > 0 ? `${added} · ${r.skipped} couldn’t be read` : added;
}
