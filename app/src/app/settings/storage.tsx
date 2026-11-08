import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ErrorText } from '@/components/form';
import { Row, Section } from '@/components/settings-ui';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { describeError } from '@/lib/account';
import { fetchStorage, formatBytes, type StorageUsage } from '@/lib/storage-usage';

const count = (n: number, one: string, many: string) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

/** Storage: how much space my photos and videos take on Circlo (owner request 2026-11-08). Only ever my own. */
export default function StorageScreen() {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [error, setError] = useState<string>();

  useFocusEffect(
    useCallback(() => {
      fetchStorage()
        .then((u) => {
          setUsage(u);
          setError(undefined);
        })
        .catch((e) => setError(describeError(e)));
    }, []),
  );

  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="pb-10">
      <View className="items-center gap-1 px-4 pb-6 pt-8">
        {usage ? (
          <>
            <Text className="text-4xl font-extrabold text-ink dark:text-ink-dark">{formatBytes(usage.usedBytes)}</Text>
            <Text className="text-[15px] text-muted dark:text-muted-dark">used by your photos and videos</Text>
          </>
        ) : error ? null : (
          <Spinner size="large" />
        )}
      </View>
      {usage ? (
        <Section>
          <Row title={count(usage.photos, 'photo', 'photos')}>
            <Text className="text-[15px] text-muted dark:text-muted-dark">{formatBytes(usage.photoBytes)}</Text>
          </Row>
          <Row title={count(usage.videos, 'video', 'videos')}>
            <Text className="text-[15px] text-muted dark:text-muted-dark">{formatBytes(usage.videoBytes)}</Text>
          </Row>
          <Row title="Profile photo">
            <Text className="text-[15px] text-muted dark:text-muted-dark">{formatBytes(usage.profilePhotoBytes)}</Text>
          </Row>
        </Section>
      ) : null}
      <View className="gap-3 px-4 pt-4">
        <ErrorText>{error}</ErrorText>
        <Text className="text-[13px] leading-[18px] text-muted dark:text-muted-dark">{NOTE}</Text>
      </View>
    </ScrollView>
  );
}

const NOTE =
  'This counts the photos and videos you’ve posted or sent in chats, with their small previews, and your profile photo. Photos and videos other people share with you don’t use your space. Deleting a post or message frees the space it used.';
