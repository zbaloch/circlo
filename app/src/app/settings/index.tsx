import type { Href } from 'expo-router';
import { ScrollView } from 'react-native';

import { NavRow } from '@/components/settings-ui';
import type { IconName } from '@/components/ui/icon';

type Page = { icon: IconName; title: string; subtitle: string; href: Href };

/** One link per area, as on X; each opens its own page. Devices comes first (it used to be in the side menu). */
export const SETTINGS_PAGES: Page[] = [
  { icon: 'phone-portrait-outline', title: 'Devices', subtitle: 'See where you’re signed in and sign out the others.', href: '/devices' },
  { icon: 'person-outline', title: 'Your account', subtitle: 'Change your password, export your data or delete your account.', href: '/settings/account' },
  { icon: 'notifications-outline', title: 'Notifications', subtitle: 'Choose how Circlo tells you about new things.', href: '/settings/notifications' },
  { icon: 'shield-checkmark-outline', title: 'Privacy and safety', subtitle: 'Who can add you, and the people you’ve blocked.', href: '/settings/privacy' },
  { icon: 'information-circle-outline', title: 'About Circlo', subtitle: 'Terms, privacy policy, child safety and help.', href: '/settings/about' },
];

/** Settings and privacy: a list of links to each settings page. */
export default function SettingsScreen() {
  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="py-2">
      {SETTINGS_PAGES.map((p) => (
        <NavRow key={p.title} icon={p.icon} title={p.title} subtitle={p.subtitle} href={p.href} />
      ))}
    </ScrollView>
  );
}
