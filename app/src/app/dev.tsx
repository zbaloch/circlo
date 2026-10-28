import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Screen } from '@/components/screen';
import { feedBenchmark, runQuickChecks, streamFile, type CheckResult } from '@/lib/selftest';
import { Text } from '@/components/ui/text';
import { Spinner } from '@/components/ui/spinner';

/** Dev-only screen: runs the native crypto core on this device (Phase 2 done-criteria). */
export default function DevScreen() {
  const [results, setResults] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState(false);

  const run = async (job: () => Promise<CheckResult[]>) => {
    setRunning(true);
    setResults([]);
    try {
      setResults(await job());
    } finally {
      setRunning(false);
    }
  };

  if (!__DEV__) {
    return null;
  }

  return (
    <Screen>
      <ScrollView contentContainerClassName="gap-3 p-4">
        <Text className="text-muted dark:text-muted-dark">
          Runs encrypt/decrypt round trips in the Rust core on this device. No network, nothing leaves the phone.
        </Text>
        <View className="flex-row gap-3">
          <Pressable
            accessibilityRole="button"
            disabled={running}
            onPress={() => run(runQuickChecks)}
            className="flex-1 items-center rounded-full bg-primary py-3 active:bg-primary-pressed dark:bg-primary-dark dark:active:bg-primary-pressed-dark">
            <Text className="font-bold text-on-primary dark:text-on-primary-dark">Run checks</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={running}
            onPress={() => run(async () => [await streamFile(200)])}
            className="flex-1 items-center rounded-full border border-primary py-3 active:opacity-60 dark:border-primary-dark">
            <Text className="font-bold text-primary dark:text-primary-dark">Stream 200 MB</Text>
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          disabled={running}
          onPress={() => run(async () => [await feedBenchmark()])}
          className="items-center rounded-full border border-primary py-3 active:opacity-60 dark:border-primary-dark">
          <Text className="font-bold text-primary dark:text-primary-dark">Feed benchmark (500 posts)</Text>
        </Pressable>
        {running ? <Spinner /> : null}
        {results.map((r) => (
          <View key={r.name} className="rounded-xl border border-border p-3 dark:border-border-dark">
            <Text className={`font-bold ${r.ok ? 'text-primary dark:text-primary-dark' : 'text-danger dark:text-danger-dark'}`}>
              {r.ok ? 'PASS' : 'FAIL'} · {r.name} · {r.ms} ms
            </Text>
            {r.detail ? <Text className="text-muted dark:text-muted-dark">{r.detail}</Text> : null}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}
