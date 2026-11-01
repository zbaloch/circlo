/**
 * The web app's device storage: the browser's localStorage for this origin (app.hellocirclo.com). Signing out clears
 * everything the account left here. Storage may be unavailable (private windows, blocked site data); then nothing is
 * remembered and the user simply signs in again next time.
 */
export type Access = 'foreground' | 'background';

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export async function getItem(key: string, _access: Access = 'foreground'): Promise<string | null> {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string, _access: Access = 'foreground'): Promise<void> {
  try {
    store()?.setItem(key, value);
  } catch {
    // full or blocked: not remembered
  }
}

export async function deleteItem(key: string, _access: Access = 'foreground'): Promise<void> {
  try {
    store()?.removeItem(key);
  } catch {
    // nothing to remove
  }
}
