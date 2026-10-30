/**
 * My display name, cached from my encrypted profile whenever it's loaded or saved, so my own posts and replies show
 * it instead of my handle. Kept in memory only; it's decrypted again on every launch.
 */
let myName: string | null = null;

export function setMyName(name: string | undefined | null) {
  myName = name?.trim() || null;
}

export function getMyName(): string | null {
  return myName;
}
