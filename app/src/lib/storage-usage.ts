/** How much storage my account uses (GET /v1/me/storage; owner request 2026-11-08), shown in Settings → Storage. */
import { api, ok } from '@/api/client';
import type { paths } from '@/api/schema';

export type StorageUsage = paths['/v1/me/storage']['get']['responses']['200']['content']['application/json'];

export async function fetchStorage(): Promise<StorageUsage> {
  return ok(await api.GET('/v1/me/storage'));
}

/** Bytes as phones show them (1 GB = 1,000,000,000 bytes): 300 KB, 4.6 MB, 400 MB, 1.2 GB. */
export function formatBytes(bytes: number): string {
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes) / 1000;
  let unit = 0;
  while (value >= 999.5 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  const shown = value < 10 && value > 0 && unit > 0 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value));
  return `${shown} ${units[unit]}`;
}
