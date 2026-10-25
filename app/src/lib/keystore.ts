import * as SecureStore from 'expo-secure-store';

/**
 * Account secrets in the iOS Keychain / Android Keystore (service com.halqo.app.keys). "This device only": keys are
 * never migrated by OS backups; a new device logs in (backup download) or is linked.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'com.halqo.app.keys',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const KEY = 'halqo.account.v1';

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
}
