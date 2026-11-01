import { deleteItem, getItem, setItem } from './storage';

/** The signed-in account on this device: who it is and its refresh token. Nothing else is kept. */
export type StoredAccount = {
  userId: string;
  deviceId: string;
  /** The username, shown as @handle. */
  handle: string;
  refreshToken: string;
};

const KEY = 'circlo.account.v2';

export async function loadAccount(): Promise<StoredAccount | null> {
  const raw = await getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAccount;
  } catch {
    return null;
  }
}

export async function saveAccount(account: StoredAccount): Promise<void> {
  await setItem(KEY, JSON.stringify(account));
}

export async function updateRefreshToken(refreshToken: string): Promise<void> {
  const account = await loadAccount();
  if (account) await saveAccount({ ...account, refreshToken });
}

export async function clearAccount(): Promise<void> {
  await deleteItem(KEY);
  // Accounts from the encrypted design (v1): their keys mean nothing to the new server.
  await deleteItem('circlo.account.v1');
  await deleteItem('circlo.local-cache-key.v1');
}
