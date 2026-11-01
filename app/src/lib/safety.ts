/** Account deletion and a copy of my data (PLAN.md Phase 11). The web app uses safety.web.ts for saving the copy. */
import { Directory } from 'expo-file-system';

import { api, ok } from '@/api/client';

/** Deletes the account on the server (after checking the password). The caller then signs out locally. */
export async function deleteAccount(password: string): Promise<void> {
  ok(await api.DELETE('/v1/account', { body: { password } }));
}

export function exportFileName(now = new Date()): string {
  return `circlo-export-${now.toISOString().slice(0, 10)}.json`;
}

/** Saves a copy of my data (profile, circles, friends, posts, replies, chats) as one JSON file in a folder I pick. */
export async function exportMyData(): Promise<string> {
  const folder = await Directory.pickDirectoryAsync();
  const data = ok(await api.GET('/v1/me/export'));
  const name = exportFileName();
  const file = folder.createFile(name, 'application/json');
  await file.write(JSON.stringify(data, null, 2));
  return name;
}
