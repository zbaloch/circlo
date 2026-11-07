import { ScrollView } from 'react-native';

import { LinkRow, NavRow, Section } from '@/components/settings-ui';
import { LINKS } from '@/lib/links';

/**
 * About Circlo: why it exists (the manifesto) and the intro again, then its terms, privacy policy, child safety
 * standards and support, opened in the browser.
 */
export default function AboutScreen() {
  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="pb-10">
      <Section>
        <LinkRow title="Why Circlo" url={LINKS.why} />
        <NavRow title="Watch the intro again" href="/intro" />
      </Section>
      <Section>
        <LinkRow title="Terms of Use" url={LINKS.terms} />
        <LinkRow title="Privacy Policy" url={LINKS.privacy} />
        <LinkRow title="Child safety standards" url={LINKS.childSafety} />
        <LinkRow title="Help and support" url={LINKS.support} />
      </Section>
    </ScrollView>
  );
}
