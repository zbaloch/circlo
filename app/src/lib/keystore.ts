import * as Core from '@circlo/core';
import * as SecureStore from 'expo-secure-store';

import { fromB64, toB64 } from './bytes';

/**
 * Account secrets in the iOS Keychain / Android Keystore (service com.circlo.app.keys). "This device only": keys are
 * never migrated by OS backups; a new device logs in (backup download) or is linked.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'com.circlo.app.keys',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const KEY = 'circlo.account.v1';

/** All byte fields are base64. */
export type StoredAccount = {
  userId: string;
  handle: string;
  deviceId: string;
  x25519Sk: string;
  x25519Pk: string;
  ed25519Sk: string;
  ed25519Pk: string;
  deviceSk: string;
  devicePk: string;
  dataKey: string;
  localRoot: string;
  refreshToken: string;
};

export async function loadAccount(): Promise<StoredAccount | null> {
  const raw = await SecureStore.getItemAsync(KEY, OPTIONS);
  return raw ? (JSON.parse(raw) as StoredAccount) : null;
}

export async function saveAccount(account: StoredAccount): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(account), OPTIONS);
}

export async function updateRefreshToken(refreshToken: string): Promise<void> {
  const account = await loadAccount();
  if (account) await saveAccount({ ...account, refreshToken });
}

export async function clearAccount(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY, OPTIONS);
  await SecureStore.deleteItemAsync(CACHE_KEY, OPTIONS);
  cacheKey = null;
}

// CRYPTO.md section 10: `local_cache_key` is random, per device, never backed up; it seals cached thumbnails.
const CACHE_KEY = 'circlo.local-cache-key.v1';
let cacheKey: ArrayBuffer | null = null;

export async function localCacheKey(): Promise<ArrayBuffer> {
  if (cacheKey) return cacheKey;
  const stored = await SecureStore.getItemAsync(CACHE_KEY, OPTIONS);
  if (stored) {
    cacheKey = fromB64(stored);
  } else {
    cacheKey = Core.newSymmetricKey();
    await SecureStore.setItemAsync(CACHE_KEY, toB64(cacheKey), OPTIONS);
  }
  return cacheKey;
}
