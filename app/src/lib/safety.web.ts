/** Account deletion and a copy of my data, in the web app (the copy downloads as a JSON file). */
import { api, ok } from '@/api/client';

export async function deleteAccount(password: string): Promise<void> {
  ok(await api.DELETE('/v1/account', { body: { password } }));
}

export function exportFileName(now = new Date()): string {
  return `circlo-export-${now.toISOString().slice(0, 10)}.json`;
}

export async function exportMyData(): Promise<string> {
  const data = ok(await api.GET('/v1/me/export'));
  const name = exportFileName();
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}
