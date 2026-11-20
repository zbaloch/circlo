import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ErrorText } from '@/components/form';
import { Section } from '@/components/settings-ui';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { describeError } from '@/lib/account';
import { change, fetchGrowth, lastTwoWeeks, METRICS, shortDate, type Growth } from '@/lib/growth';

const n = (v: number) => v.toLocaleString('en');

/**
 * Growth (admins only; owner request 2026-11-20): totals, this week against last, and each of the last 30 days. Only
 * counts, never who. Days are UTC.
 */
export default function GrowthScreen() {
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [error, setError] = useState<string>();

  useFocusEffect(
    useCallback(() => {
      fetchGrowth()
        .then((g) => {
          setGrowth(g);
          setError(undefined);
        })
        .catch((e) => setError(describeError(e)));
    }, []),
  );

  if (!growth) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-surface px-4 dark:bg-surface-dark">
        {error ? <ErrorText>{error}</ErrorText> : <Spinner size="large" />}
      </View>
    );
  }

  const totals = [
    { label: 'People', value: growth.totals.people },
    { label: 'Connections', value: growth.totals.connections },
    { label: 'Posts', value: growth.totals.posts },
  ];
  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="pb-10">
      <View className="flex-row gap-3 px-4 pb-2 pt-6">
        {totals.map((t) => (
          <View key={t.label} accessible className="flex-1 items-center rounded-2xl border border-border py-4 dark:border-border-dark">
            <Text className="text-2xl font-extrabold text-ink dark:text-ink-dark">{n(t.value)}</Text>
            <Text className="text-[13px] text-muted dark:text-muted-dark">{t.label}</Text>
          </View>
        ))}
      </View>

      <Text className="px-4 pb-1 pt-6 text-xs font-semibold uppercase text-muted dark:text-muted-dark">Last 7 days</Text>
      <Section>
        {METRICS.map((m) => {
          const w = lastTwoWeeks(growth.days, m.key);
          return (
            <View key={m.key} accessible className="flex-row items-center px-4 py-3">
              <Text className="flex-1 text-[15px] text-ink dark:text-ink-dark">{m.label}</Text>
              <Text className="w-12 text-right text-[15px] font-bold text-ink dark:text-ink-dark">{n(w.thisWeek)}</Text>
              <Text className="w-24 text-right text-[13px] text-muted dark:text-muted-dark">{change(w.thisWeek, w.lastWeek)} on last</Text>
            </View>
          );
        })}
      </Section>

      <Text className="px-4 pb-1 pt-6 text-xs font-semibold uppercase text-muted dark:text-muted-dark">Each day (UTC)</Text>
      <View className="flex-row border-b border-border px-4 py-2 dark:border-border-dark">
        <Text className="w-16 text-xs font-semibold text-muted dark:text-muted-dark">Day</Text>
        {METRICS.map((m) => (
          <Text key={m.key} className="flex-1 text-right text-xs font-semibold text-muted dark:text-muted-dark">
            {m.short}
          </Text>
        ))}
      </View>
      {growth.days.map((d) => (
        <View key={d.date} accessible className="flex-row px-4 py-2">
          <Text className="w-16 text-[13px] text-ink dark:text-ink-dark">{shortDate(d.date)}</Text>
          {METRICS.map((m) => (
            <Text
              key={m.key}
              className={`flex-1 text-right text-[13px] ${d[m.key] ? 'font-semibold text-ink dark:text-ink-dark' : 'text-muted dark:text-muted-dark'}`}>
              {d[m.key] ? n(d[m.key]) : '·'}
            </Text>
          ))}
        </View>
      ))}
      <Text className="px-4 pt-4 text-[13px] leading-[18px] text-muted dark:text-muted-dark">
        Counts only, never who. They come from what’s already on Circlo, so a deleted account or post drops out of past
        days too. Only admins see this page.
      </Text>
    </ScrollView>
  );
}
