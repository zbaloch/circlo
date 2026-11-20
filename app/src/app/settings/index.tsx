import type { Href } from 'expo-router';
import { ScrollView } from 'react-native';

import { NavRow } from '@/components/settings-ui';
import type { IconName } from '@/components/ui/icon';
import { useMe } from '@/lib/me';

type Page = { icon: IconName; title: string; subtitle: string; href: Href };

/** One link per area, as on X; each opens its own page. Devices comes first (it used to be in the side menu). */
export const SETTINGS_PAGES: Page[] = [
  { icon: 'phone-portrait-outline', title: 'Devices', subtitle: 'See where you’re signed in and sign out the others.', href: '/devices' },
  { icon: 'person-outline', title: 'Your account', subtitle: 'Change your password, export your data or delete your account.', href: '/settings/account' },
  { icon: 'images', title: 'Storage', subtitle: 'See how much space your photos and videos use.', href: '/settings/storage' },
  { icon: 'contrast-outline', title: 'Display', subtitle: 'Light, dark or dim, or the way your device is set.', href: '/settings/display' },
  { icon: 'notifications-outline', title: 'Notifications', subtitle: 'Choose how Circlo tells you about new things.', href: '/settings/notifications' },
  { icon: 'shield-checkmark-outline', title: 'Privacy and safety', subtitle: 'Who can add you, who sees you in shared circles, and the people you’ve blocked.', href: '/settings/privacy' },
  { icon: 'information-circle-outline', title: 'About Circlo', subtitle: 'Terms, privacy policy, child safety and help.', href: '/settings/about' },
];

/** Only for Circlo's admins (CIRCLO_ADMIN_EMAILS): counts per day, never who. */
export const GROWTH_PAGE: Page = {
  icon: 'trending-up-outline',
  title: 'Growth',
  subtitle: 'Sign-ups, invites, connections and posts each day. Only admins see this.',
  href: '/settings/growth',
};

/** Pure: the pages listed, Growth last and only for admins. */
export function settingsPages(admin: boolean): Page[] {
  return admin ? [...SETTINGS_PAGES, GROWTH_PAGE] : SETTINGS_PAGES;
}

/** Settings and privacy: a list of links to each settings page. */
export default function SettingsScreen() {
  const me = useMe();
  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="py-2">
      {settingsPages(me?.admin ?? false).map((p) => (
        <NavRow key={p.title} icon={p.icon} title={p.title} subtitle={p.subtitle} href={p.href} />
      ))}
    </ScrollView>
  );
}
