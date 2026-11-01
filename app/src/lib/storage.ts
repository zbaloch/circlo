import * as SecureStore from 'expo-secure-store';

/**
 * Small values kept on this device: the session's refresh token and per-account markers ("seen up to"). On phones
 * they live in the iOS Keychain / Android Keystore, never in OS backups. `background` values stay readable while
 * the phone is locked (after its first unlock), for background checks. The web build uses storage.web.ts.
 */
export type Access = 'foreground' | 'background';

const OPTIONS: Record<Access, SecureStore.SecureStoreOptions> = {
  foreground: { keychainService: 'com.circlo.app.keys', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  background: { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY },
};

export async function getItem(key: string, access: Access = 'foreground'): Promise<string | null> {
  return SecureStore.getItemAsync(key, OPTIONS[access]).catch(() => null);
}

export async function setItem(key: string, value: string, access: Access = 'foreground'): Promise<void> {
  await SecureStore.setItemAsync(key, value, OPTIONS[access]);
}

export async function deleteItem(key: string, access: Access = 'foreground'): Promise<void> {
  await SecureStore.deleteItemAsync(key, OPTIONS[access]).catch(() => undefined);
}
