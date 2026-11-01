import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import { api, ok } from '@/api/client';
import { Screen } from '@/components/screen';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { describeError } from '@/lib/account';
import { showAlert } from '@/lib/dialog';

type Device = { deviceId: string; createdAt: string; current: boolean };

/** Phones and browsers signed in to this account. Signing one out ends its session there. */
export default function DevicesScreen() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setDevices(ok(await api.GET('/v1/devices')));
      setError(undefined);
    } catch (e) {
      setError(describeError(e));
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const signOut = (d: Device) =>
    showAlert('Sign out this device?', 'It will need your password to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          try {
            ok(await api.DELETE('/v1/devices/{deviceId}', { params: { path: { deviceId: d.deviceId } } }));
            load();
          } catch (e) {
            showAlert('Couldn’t sign it out', describeError(e));
          }
        },
      },
    ]);

  const sorted = [...(devices ?? [])].sort((a, b) => Number(b.current) - Number(a.current) || Date.parse(b.createdAt) - Date.parse(a.createdAt));

  return (
    <Screen>
      {devices === null && !error ? (
        <Spinner className="mt-10" />
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(d) => d.deviceId}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          contentContainerClassName="gap-3 p-4"
          ListHeaderComponent={
            <View className="gap-2 pb-2">
              <Text className="text-sm text-muted dark:text-muted-dark">
                Everywhere you’re signed in to Circlo. If you don’t recognise one, sign it out and change your password.
              </Text>
              {error ? <Text className="text-danger dark:text-danger-dark">{error}</Text> : null}
            </View>
          }
          renderItem={({ item }) => (
            <View className="flex-row items-center gap-3 rounded-xl border border-border p-4 dark:border-border-dark">
              <View className="flex-1">
                <Text className="font-bold text-ink dark:text-ink-dark">{item.current ? 'This device' : 'Other device'}</Text>
                <Text className="text-muted dark:text-muted-dark">Signed in {new Date(item.createdAt).toLocaleString()}</Text>
              </View>
              {!item.current ? (
                <Pressable accessibilityRole="button" onPress={() => signOut(item)}>
                  <Text className="font-semibold text-danger dark:text-danger-dark">Sign out</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        />
      )}
    </Screen>
  );
}
