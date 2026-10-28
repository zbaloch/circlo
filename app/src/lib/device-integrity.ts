/**
 * Rooted / jailbroken phone warning (PLAN.md Phase 12: warn only, never block). On such a phone other apps may be
 * able to read Circlo's keys and decrypted data, so the user should know; whether to keep using it is their choice.
 */
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

const DISMISSED = 'circlo.integrity-warning-dismissed';

/** The warning to show, or null on a normal phone. Pure; exported for tests. */
export function integrityWarning(compromised: boolean, os: string): string | null {
  if (!compromised) return null;
  const what = os === 'ios' ? 'jailbroken' : 'rooted';
  return `This phone looks ${what}. Other apps on it may be able to read your Circlo keys and messages. Circlo still works, but your encryption is only as safe as this phone.`;
}

let check: Promise<boolean> | null = null;

/** Whether the phone looks rooted/jailbroken (checked once per launch; a failed check counts as "no"). */
export function isCompromised(): Promise<boolean> {
  check ??= Device.isRootedExperimentalAsync().catch(() => false);
  return check;
}

/** The warning for Home (until dismissed) and Settings (always). */
export function useIntegrityWarning(): { message: string | null; dismissed: boolean; dismiss: () => void } {
  const [message, setMessage] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    let live = true;
    Promise.all([isCompromised(), SecureStore.getItemAsync(DISMISSED).catch(() => null)]).then(([bad, flag]) => {
      if (!live) return;
      setMessage(integrityWarning(bad, Platform.OS));
      setDismissed(flag === '1');
    });
    return () => {
      live = false;
    };
  }, []);
  const dismiss = () => {
    setDismissed(true);
    SecureStore.setItemAsync(DISMISSED, '1').catch(() => undefined);
  };
  return { message, dismissed, dismiss };
}
