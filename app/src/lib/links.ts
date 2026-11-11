/** Circlo's public web pages (terms, privacy, support), as required by the app stores. */
import * as Linking from 'expo-linking';

const SITE = 'https://www.hellocirclo.com';

export const LINKS = {
  why: `${SITE}/why`,
  terms: `${SITE}/terms`,
  privacy: `${SITE}/privacy`,
  support: `${SITE}/support`,
  childSafety: `${SITE}/child-safety`,
  deleteAccount: `${SITE}/delete-account`,
} as const;

/** Circlo on the App Store (iPhone and iPad). Without a country, so it opens in each visitor's own store. */
export const APP_STORE_URL = 'https://apps.apple.com/app/circlo-family-friends/id6828949778';

export function openLink(url: string) {
  void Linking.openURL(url);
}
