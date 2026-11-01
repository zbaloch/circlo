/**
 * Live updates while the app is open: one long-held request (GET /v1/events) that the server answers the moment
 * something changes for me (a reply, like, message, request or new post), or after 25 s. The answer says only that
 * something changed; listeners then refresh what they show through the usual endpoints. Polling stays as a fallback.
 */
import { api } from '@/api/client';

const listeners = new Set<() => void>();

/** Called on every change while live updates run. Returns the unsubscribe. */
export function onLiveChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pure: whether an answer means something changed (the first answer only tells us where we are). Exported for tests. */
export function isChange(previous: number | null, next: number): boolean {
  return previous !== null && next !== previous;
}

/**
 * Runs the long-poll loop until the returned stop is called. `active()` pauses it (e.g. while the app is in the
 * background). Waits between failed attempts so a broken connection never spins.
 */
export function startLive(active: () => boolean): () => void {
  let stopped = false;
  let version: number | null = null;
  void (async () => {
    while (!stopped) {
      if (!active()) {
        await sleep(2_000);
        continue;
      }
      try {
        const since: number = version ?? 0;
        const res = await api.GET('/v1/events', { params: { query: { since } } });
        const next: number | undefined = res.data?.version;
        if (stopped) break;
        if (next === undefined) {
          await sleep(5_000);
          continue;
        }
        const changed = isChange(version, next);
        version = next;
        if (changed) listeners.forEach((l) => l());
      } catch {
        await sleep(5_000);
      }
      await sleep(250);
    }
  })();
  return () => {
    stopped = true;
  };
}
