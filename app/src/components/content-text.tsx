import * as Linking from 'expo-linking';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { runs, type Run } from '@/lib/script';
import { linkParts } from '@/lib/view-logic';

/** Pure: the classes for one run: right-aligned when right to left, and Nastaliq's taller lines. Exported for tests. */
export function runClass(className: string, run: Run): string {
  let cls = className;
  if (run.script === 'nastaliq') {
    // Nastaliq's letters sit on a slanted baseline and need about twice the font size in line height.
    const big = /(^|\s)(text-\[1[6-9]px\]|text-base|text-lg|text-xl)(\s|$)/.test(cls);
    cls = cls.replace(/(^|\s)leading-\S+/g, ' ').trim() + (big ? ' leading-9' : ' leading-8');
  }
  return run.dir === 'rtl' ? `${cls} text-right` : cls;
}

/**
 * What people wrote (posts, replies, messages, bios), each paragraph in its own direction and its script's font
 * (lib/script): a Sindhi verse right-aligned in Noto Naskh Arabic, an Urdu line in Noto Nastaliq Urdu, English in
 * Inter as before. Links are tappable.
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
      <Text numberOfLines={numberOfLines} script={parts[0].script} className={runClass(className, parts[0])}>
        {body(parts[0].text)}
      </Text>
    );
  }
  return (
    <View>
      {parts.map((run, i) => (
        <Text key={i} script={run.script} className={runClass(className, run)}>
          {body(run.text)}
        </Text>
      ))}
    </View>
  );
}
