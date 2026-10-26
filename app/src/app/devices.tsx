import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';

import { api, ok } from '@/api/client';
import { Screen } from '@/components/screen';
import { describeError } from '@/lib/account';
import { useSession } from '@/lib/session';

type Device = { deviceId?: string; createdAt?: string; revoked?: boolean };

/** Devices that hold this account's keys. Linking and revoking arrive in Phase 10. */
export default function DevicesScreen() {
  const session = useSession();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const thisDevice = session.status === 'signedIn' ? session.account.deviceId : '';

  const load = useCallback(
    () =>
      api.GET('/v1/devices').then(
        (r) => {
          setDevices(ok(r) as Device[]);
          setError(undefined);
        },
        (e) => setError(describeError(e)),
      ),
    [],
  );

  useEffect(() => {
    api.GET('/v1/devices').then(
      (r) => {
        try {
          setDevices(ok(r) as Device[]);
        } catch (e) {
          setError(describeError(e));
        }
      },
      (e) => setError(describeError(e)),
    );
  }, []);

  return (
    <Screen>
      {devices === null && !error ? (
        <ActivityIndicator className="mt-10" />
      ) : (
        <FlatList
          data={devices ?? []}
          keyExtractor={(d) => d.deviceId ?? ''}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          contentContainerClassName="gap-3 p-4"
          ListHeaderComponent={error ? <Text className="text-danger dark:text-danger-dark">{error}</Text> : undefined}
          renderItem={({ item }) => (
            <View className="rounded-xl border border-border p-4 dark:border-border-dark">
              <Text className="font-bold text-ink dark:text-ink-dark">
                {item.deviceId === thisDevice ? 'This device' : 'Other device'}
                {item.revoked ? ' (revoked)' : ''}
              </Text>
              <Text className="text-muted dark:text-muted-dark">
                Added {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}
              </Text>
            </View>
          )}
        />
      )}
    </Screen>
  );
}
