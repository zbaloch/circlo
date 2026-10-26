import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';

import { api, ok } from '@/api/client';
import { ErrorText } from '@/components/form';
import { Screen } from '@/components/screen';
import { describeError } from '@/lib/account';
import { usePalette } from '@/theme/use-palette';

/** Settings. Handle search is off by default (more private); invites always work. */
export default function SettingsScreen() {
  const palette = usePalette();
  const [discoverable, setDiscoverable] = useState<boolean | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.GET('/v1/me/discoverable').then(
      (r) => {
        try {
          setDiscoverable(ok(r).discoverable);
        } catch (e) {
          setError(describeError(e));
        }
      },
      (e) => setError(describeError(e)),
    );
  }, []);

  const toggle = async (value: boolean) => {
    setDiscoverable(value);
    try {
      ok(await api.PUT('/v1/me/discoverable', { body: { discoverable: value } }));
    } catch (e) {
      setDiscoverable(!value);
      setError(describeError(e));
    }
  };

  return (
    <Screen>
      <View className="gap-4 p-5">
        <View className="flex-row items-center gap-4 rounded-2xl border border-border p-4 dark:border-border-dark">
          <View className="flex-1 gap-1">
            <Text className="text-base font-bold text-ink dark:text-ink-dark">Let people find me by handle</Text>
            <Text className="text-muted dark:text-muted-dark">
              Off: only people you invite can add you. On: anyone who types your exact handle can send a request.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Let people find me by handle"
            value={!!discoverable}
            disabled={discoverable === null}
            onValueChange={toggle}
            trackColor={{ true: palette.primary }}
          />
        </View>
        <ErrorText>{error}</ErrorText>
      </View>
    </Screen>
  );
}
