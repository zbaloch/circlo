import * as Linking from 'expo-linking';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { runs, type Run } from '@/lib/script';
import { linkParts } from '@/lib/view-logic';

/** Pure: the classes for one run: right-aligned when right to left. Exported for tests. */
export function runClass(className: string, run: Run): string {
  return run.dir === 'rtl' ? `${className} text-right` : className;
}

/**
 * What people wrote (posts, replies, messages, bios), each paragraph in its own direction (lib/script): a Sindhi verse
 * right-aligned, English as before. Latin, Greek and Cyrillic are in Inter; any other script in the phone's own fonts.
 * Links are tappable.
 */
export function ContentText({ text, className, links = true, numberOfLines }: {
  text: string;
  className: string;
  links?: boolean;
  numberOfLines?: number;
}) {
  const parts = runs(text);
  // A paragraph ending in a blank line keeps it: a trailing line break alone draws nothing, so add a zero-width space.
  const body = (raw: string) => {
    const t = raw.endsWith('\n') ? raw + '​' : raw;
    return links
      ? linkParts(t).map((part, i) =>
          part.url ? (
            <Text key={i} accessibilityRole="link" onPress={() => Linking.openURL(part.url!)} className="text-primary dark:text-primary-dark">
              {part.text}
            </Text>
          ) : (
            part.text
          ),
        )
      : t;
  };
  if (parts.length === 1) {
    return (
      <Text numberOfLines={numberOfLines} system={parts[0].system} className={runClass(className, parts[0])}>
        {body(parts[0].text)}
      </Text>
    );
  }
  return (
    <View>
      {parts.map((run, i) => (
        <Text key={i} system={run.system} className={runClass(className, run)}>
          {body(run.text)}
        </Text>
      ))}
    </View>
  );
}
