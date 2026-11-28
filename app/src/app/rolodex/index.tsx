import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView } from 'react-native';

import { PeopleList } from '@/components/people-ui';
import { Screen } from '@/components/screen';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { refreshPeople, usePeople } from '@/lib/people-store';
import { showToast } from '@/lib/toast';

/**
 * The Rolodex (owner 2026-11-28), from the side menu: my personal CRM. Everyone I'm connected to and the people I
 * add, on Circlo or not, with Coming up at the top. Only I ever see it. Reloaded each time it opens, so new
 * connections show up.
 */
export default function RolodexScreen() {
  const { people, loaded } = usePeople();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshPeople().catch(() => showToast('Couldn’t load your Rolodex. Pull down to try again.'));
    }, []),
  );

  return (
    <Screen>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-5 p-5"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await refreshPeople().catch(() => undefined);
              setRefreshing(false);
            }}
          />
        }>
        {loaded ? (
          <>
            {people.length === 0 ? (
              <Text className="text-[15px] text-muted dark:text-muted-dark">
                Remember birthdays and keep catching up with the people in your life. Your connections show up here, and you can add
                anyone who isn’t on Circlo.
              </Text>
            ) : null}
            <PeopleList people={people} today={new Date()} />
          </>
        ) : (
          <Spinner className="py-10" />
        )}
      </ScrollView>
    </Screen>
  );
}
