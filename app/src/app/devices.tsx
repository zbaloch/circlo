import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { api, ok } from '@/api/client';
import { Button } from '@/components/form';
import { Screen } from '@/components/screen';
import { describeError } from '@/lib/account';
import { useSession } from '@/lib/session';

type Device = { deviceId?: string; createdAt?: string; revoked?: boolean };

/** Devices that hold this account's keys: link a new one by QR, revoke the ones you don't use. */
export default function DevicesScreen() {
  const session = useSession();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const thisDevice = session.status === 'signedIn' ? session.account.deviceId : '';

  const load = useCallback(async () => {
    try {
      setDevices(ok(await api.GET('/v1/devices')) as Device[]);
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

  const revoke = (d: Device) =>
    Alert.alert('Revoke this device?', 'It will be signed out of messaging and stop getting notifications. It keeps anything already on it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          try {
            ok(await api.DELETE('/v1/devices/{deviceId}', { params: { path: { deviceId: d.deviceId! } } }));
            load();
          } catch (e) {
            Alert.alert('Couldn’t revoke', describeError(e));
          }
        },
      },
    ]);

  const sorted = [...(devices ?? [])].sort(
    (a, b) => Number(!!a.revoked) - Number(!!b.revoked) || Number(b.deviceId === thisDevice) - Number(a.deviceId === thisDevice),
  );

  return (
    <Screen>
      {devices === null && !error ? (
        <ActivityIndicator className="mt-10" />
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(d) => d.deviceId ?? ''}
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
            <View className="gap-3 pb-2">
              <Button label="Link a new device" onPress={() => router.push('/scan')} />
              <Text className="text-sm text-muted dark:text-muted-dark">
                On the new phone, choose “Link from another device” and scan its code with this phone.
              </Text>
              {error ? <Text className="text-danger dark:text-danger-dark">{error}</Text> : null}
            </View>
          }
          renderItem={({ item }) => (
            <View className={`flex-row items-center gap-3 rounded-xl border border-border p-4 dark:border-border-dark ${item.revoked ? 'opacity-50' : ''}`}>
              <View className="flex-1">
                <Text className="font-bold text-ink dark:text-ink-dark">
                  {item.deviceId === thisDevice ? 'This device' : 'Other device'}
                  {item.revoked ? ' (revoked)' : ''}
                </Text>
                <Text className="text-muted dark:text-muted-dark">Added {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</Text>
              </View>
              {!item.revoked && item.deviceId !== thisDevice ? (
                <Pressable accessibilityRole="button" onPress={() => revoke(item)}>
                  <Text className="font-semibold text-danger dark:text-danger-dark">Revoke</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        />
      )}
    </Screen>
  );
}
