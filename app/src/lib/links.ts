/** Circlo's public web pages (terms, privacy, support), as required by the app stores. */
import * as Linking from 'expo-linking';

const SITE = 'https://www.hellocirclo.com';

export const LINKS = {
  terms: `${SITE}/terms`,
  privacy: `${SITE}/privacy`,
  support: `${SITE}/support`,
  childSafety: `${SITE}/child-safety`,
  deleteAccount: `${SITE}/delete-account`,
} as const;

export function openLink(url: string) {
  void Linking.openURL(url);
}
