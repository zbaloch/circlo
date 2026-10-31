import { View } from 'react-native';

import { Text } from '@/components/ui/text';

/** A recovery phrase as numbered words, three to a row. */
export function PhraseWords({ words }: { words: string[] }) {
  return (
    <View className="flex-row flex-wrap gap-2" accessibilityLabel={`Recovery phrase, ${words.length} words`}>
      {words.map((w, i) => (
        <View key={i} className="w-[31%] flex-row gap-1 rounded-lg bg-surface-raised px-2 py-2 dark:bg-surface-raised-dark">
          <Text className="w-6 text-right text-muted dark:text-muted-dark">{i + 1}.</Text>
          <Text className="font-semibold text-ink dark:text-ink-dark">{w}</Text>
        </View>
      ))}
    </View>
  );
}
