import Constants from 'expo-constants';

/** This copy of Circlo's version ("1.3.0", from app.config.ts), shown in About Circlo; null if it isn't known. */
export function appVersion(): string | null {
  return Constants.expoConfig?.version ?? null;
}
