import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { ContentText } from '@/components/content-text';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/form';
import { IconButton } from '@/components/icon-button';
import { KeyboardSpacer } from '@/components/keyboard-spacer';
import { CatchUpSheet, DateSheet, LinkSheet, NameSheet } from '@/components/people-ui';
import { Screen } from '@/components/screen';
import { ChoiceChips } from '@/components/sheet';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text, TextInput } from '@/components/ui/text';
import { showAlert } from '@/lib/dialog';
import { CHAT_ENABLED } from '@/lib/features';
import { startChat } from '@/lib/messaging';
import {
  addPersonNote,
  agoText,
  dateLine,
  deletePersonNote,
  dueInDays,
  loadPersonNotes,
  noteDay,
  RHYTHMS,
  type Contact,
  type ContactDate,
  type ContactFields,
  type ContactNote,
} from '@/lib/people';
import {
  deletePersonNow,
  entryFor,
  findPerson,
  linkPersonNow,
  noteAdded,
  noteDeleted,
  refreshPeople,
  savePersonNow,
  unlinkPersonNow,
  usePeople,
} from '@/lib/people-store';
import { useSession } from '@/lib/session';
import { showToast } from '@/lib/toast';
import { usePalette } from '@/theme/use-palette';

const SHORT: Record<number, string> = { 7: 'Week', 14: '2 weeks', 30: 'Month', 90: '3 months', 180: '6 months', 365: 'Year' };

/**
 * One person in People (owner 2026-11-28), seen only by me: their name and photo (View profile and Message while
 * we're connected; Link to a connection otherwise), how often to catch up and when we last did, days to remember, and
 * a dated log of notes and catch-ups with a field for the next note. For a connection I haven't written about, the
 * entry is made with the first thing I write.
 */
export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { people, loaded } = usePeople();
  const entry = findPerson(people, id);

  useEffect(() => {
    if (!loaded) refreshPeople().catch(() => undefined);
  }, [loaded]);

  if (!entry) {
    return (
      <Screen>
        {loaded ? <EmptyState icon="people-outline" title="Not here any more" body="This person was deleted from People." /> : <Spinner className="flex-1 py-10" />}
      </Screen>
    );
  }
  return <Person key={entry.contactId ?? id} entry={entry} />;
}

function Person({ entry }: { entry: Contact }) {
  const navigation = useNavigation();
  const palette = usePalette();
  const session = useSession();
  const { people } = usePeople();
  const [notes, setNotes] = useState<ContactNote[] | null>(entry.contactId ? null : []);
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [sheet, setSheet] = useState<'name' | 'date' | 'catch-up' | 'link' | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const list = useRef<FlatList<ContactNote>>(null);
  const today = new Date();
  // The latest entry, for saves made after an earlier one changed it (and made it, for a connection).
  const latest = useRef(entry);
  useEffect(() => {
    latest.current = entry;
  }, [entry]);

  useEffect(() => {
    if (!entry.contactId) return;
    let live = true;
    loadPersonNotes(entry.contactId).then(
      (n) => live && setNotes(n),
      () => live && setNotes([]),
    );
    return () => {
      live = false;
    };
  }, [entry.contactId]);

  const fields = (over: Partial<ContactFields>): ContactFields => ({
    name: latest.current.name,
    keepInTouchDays: latest.current.keepInTouchDays,
    dates: latest.current.dates,
    ...over,
  });
  const save = async (over: Partial<ContactFields>) => {
    try {
      const saved = await savePersonNow(latest.current, fields(over));
      if (!entry.contactId) router.setParams({ id: saved.contactId! });
    } catch {
      showToast('Couldn’t save that. Try again.');
    }
  };

  useEffect(() => {
    const menu = () => {
      const c = latest.current;
      showAlert(c.name, undefined, [
        { text: 'Rename', onPress: () => setSheet('name') },
        ...(c.contactId && c.person
          ? [{ text: 'Unlink from their account', onPress: () => void unlinkPersonNow(c.contactId!).catch(() => showToast('Couldn’t unlink. Try again.')) }]
          : []),
        ...(c.contactId
          ? [
              {
                text: c.person ? 'Delete my notes' : 'Delete',
                style: 'destructive' as const,
                onPress: () =>
                  showAlert(c.person ? 'Delete your notes about them?' : `Delete ${c.name}?`, 'Their dates, notes and catch-ups are deleted too.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => {
                        router.back();
                        deletePersonNow(c.contactId!).catch(() => showToast('Couldn’t delete. Try again.'));
                      },
                    },
                  ]),
              },
            ]
          : []),
        { text: 'Cancel', style: 'cancel' },
      ]);
    };
    navigation.setOptions({
      headerRight: () => (
        <IconButton accessibilityLabel="More" className="mr-2" onPress={menu}>
          <Icon name="ellipsis-horizontal" size={22} color={palette.ink} />
        </IconButton>
      ),
    });
  }, [navigation, palette.ink]);

  const addNote = async (body: string, caughtUp = false, daysAgo = 0) => {
    const made = await entryFor(latest.current);
    let at: string | undefined;
    if (caughtUp && daysAgo > 0) {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      at = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    const n = await addPersonNote(made.contactId!, { body, caughtUp, at });
    setNotes((all) => [...(all ?? []), n].sort((a, b) => a.at.localeCompare(b.at)));
    noteAdded(made.contactId!, n);
    if (!entry.contactId) router.setParams({ id: made.contactId! });
    setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  };

  const send = async () => {
    const body = note.trim();
    if (!body || adding) return;
    setAdding(true);
    try {
      await addNote(body);
      setNote('');
    } catch {
      showToast('Couldn’t add the note. Try again.');
    } finally {
      setAdding(false);
    }
  };

  const remove = (n: ContactNote) =>
    showAlert(n.caughtUp ? 'Delete this catch-up?' : 'Delete this note?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const id = latest.current.contactId!;
          setNotes((all) => all && all.filter((x) => x.noteId !== n.noteId));
          deletePersonNote(id, n.noteId)
            .then(() => noteDeleted(id))
            .catch(() => {
              setNotes((all) => (all ? [...all, n].sort((a, b) => a.at.localeCompare(b.at)) : all));
              showToast('Couldn’t delete it. Try again.');
            });
        },
      },
    ]);

  const due = dueInDays(entry, today);
  const rhythm =
    entry.keepInTouchDays === null
      ? null
      : [
          entry.lastCaughtUp ? `Last caught up ${agoText(entry.lastCaughtUp, today)}` : 'Not caught up yet',
          due === null ? '' : due < 0 ? 'time to catch up' : due === 0 ? 'due today' : `next in ${due} ${due === 1 ? 'day' : 'days'}`,
        ]
          .filter(Boolean)
          .join(' · ');
  const editingDate = editing === null ? null : (entry.dates[editing] ?? null);
  const setDates = (dates: ContactDate[]) => save({ dates });
  const userId = entry.person?.userId;

  const header = (
    <View className="gap-6 px-5 pb-2 pt-4">
      <View className="flex-row items-center gap-4">
        <Avatar id={userId ?? entry.contactId ?? entry.name} name={entry.name} uri={entry.person?.avatarUrl} size="lg" />
        <View className="flex-1 gap-0.5">
          <Text accessibilityRole="header" className="text-2xl font-bold text-ink dark:text-ink-dark">{entry.name}</Text>
          <Text className="text-muted dark:text-muted-dark">
            {entry.person ? `@${entry.person.username} · on Circlo` : 'Not on Circlo'} · only you see this
          </Text>
        </View>
      </View>
      {userId ? (
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button label="View profile" variant="outline" onPress={() => router.push({ pathname: '/friend/[id]', params: { id: userId } })} />
          </View>
          {CHAT_ENABLED && session.status === 'signedIn' ? (
            <View className="flex-1">
              <Button
                label="Message"
                variant="outline"
                onPress={() =>
                  void startChat(session.account, [userId]).then(
                    (chatId) => router.push({ pathname: '/chat/[id]', params: { id: chatId } }),
                    () => showToast('Couldn’t open the chat. Try again.'),
                  )
                }
              />
            </View>
          ) : null}
        </View>
      ) : (
        <Button label="Link to a connection" variant="outline" onPress={() => setSheet('link')} />
      )}

      <View className="gap-3">
        <Text accessibilityRole="header" className="text-sm font-semibold text-muted dark:text-muted-dark">Keep in touch</Text>
        <ChoiceChips
          label="How often to catch up"
          selected={entry.keepInTouchDays === null ? 'off' : String(entry.keepInTouchDays)}
          onSelect={(v) => void save({ keepInTouchDays: v === 'off' ? null : Number(v) })}
          options={[{ value: 'off', label: 'Off' }, ...RHYTHMS.map((d) => ({ value: String(d), label: SHORT[d] }))]}
        />
        <View className="flex-row items-center gap-3">
          <Text className={`flex-1 ${due !== null && due <= 0 ? 'font-semibold text-primary dark:text-primary-dark' : 'text-muted dark:text-muted-dark'}`}>
            {rhythm ?? (entry.lastCaughtUp ? `Last caught up ${agoText(entry.lastCaughtUp, today)}` : 'A reminder comes when it’s time to catch up.')}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Caught up"
            onPress={() => setSheet('catch-up')}
            className="flex-row items-center gap-1 rounded-full bg-primary px-3.5 py-1.5 active:opacity-80 dark:bg-primary-dark">
            <Icon name="checkmark" size={16} color={palette.onPrimary} />
            <Text className="font-semibold text-on-primary dark:text-on-primary-dark">Caught up</Text>
          </Pressable>
        </View>
      </View>

      <View className="gap-2">
        <Text accessibilityRole="header" className="text-sm font-semibold text-muted dark:text-muted-dark">Dates</Text>
        {entry.dates.map((d, i) => (
          <Pressable
            key={`${d.label}-${i}`}
            accessibilityRole="button"
            accessibilityLabel={`${d.label}, ${dateLine(d, today)}. Edit`}
            onPress={() => {
              setEditing(i);
              setSheet('date');
            }}
            className="flex-row items-center gap-3 py-1.5 active:opacity-60">
            <Icon name="cake-outline" size={18} color={palette.muted} />
            <View className="flex-1">
              <Text className="font-semibold text-ink dark:text-ink-dark">{d.label}</Text>
              <Text className="text-muted dark:text-muted-dark">{dateLine(d, today)}</Text>
            </View>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={entry.dates.length ? 'Add another date' : 'Add a birthday or another date'}
          onPress={() => {
            setEditing(null);
            setSheet('date');
          }}
          className="flex-row items-center gap-2 self-start py-1.5 active:opacity-60">
          <Icon name="add" size={18} color={palette.primary} />
          <Text className="font-semibold text-primary dark:text-primary-dark">{entry.dates.length ? 'Add another date' : 'Add a birthday or another date'}</Text>
        </Pressable>
      </View>

      <Text accessibilityRole="header" className="pt-2 text-sm font-semibold text-muted dark:text-muted-dark">Notes</Text>
      {notes === null ? <Spinner className="py-4" /> : null}
      {notes?.length === 0 ? <Text className="text-[15px] text-muted dark:text-muted-dark">Nothing yet. Add a note below.</Text> : null}
    </View>
  );

  return (
    <Screen>
      <FlatList
        ref={list}
        data={notes ?? []}
        keyExtractor={(n) => n.noteId}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="pb-6"
        ListHeaderComponent={header}
        renderItem={({ item: n }) => (
          <Pressable
            accessibilityRole="text"
            accessibilityHint="Long press to delete"
            onLongPress={() => remove(n)}
            delayLongPress={300}
            className="mx-5 mb-3 gap-1 rounded-2xl bg-surface-raised px-4 py-3 active:opacity-80 dark:bg-surface-raised-dark">
            <Text className="text-sm text-muted dark:text-muted-dark">
              {noteDay(n.at, today)}
              {n.caughtUp ? ' · Caught up' : ''}
            </Text>
            {n.body ? <ContentText text={n.body} className="text-base leading-6 text-ink dark:text-ink-dark" /> : null}
          </Pressable>
        )}
      />
      <View className="flex-row items-end gap-2 border-t border-border bg-surface px-3 py-2 dark:border-border-dark dark:bg-surface-dark">
        <TextInput
          accessibilityLabel="New note"
          placeholder="Add a note"
          placeholderTextColor={palette.muted}
          value={note}
          onChangeText={setNote}
          multiline
          maxLength={10_000}
          className="max-h-28 flex-1 rounded-2xl bg-surface-raised px-4 py-2 text-base text-ink dark:bg-surface-raised-dark dark:text-ink-dark"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add note"
          disabled={!note.trim() || adding}
          onPress={() => void send()}
          className={`h-10 w-10 items-center justify-center rounded-full bg-primary dark:bg-primary-dark ${!note.trim() || adding ? 'opacity-50' : ''}`}>
          {adding ? <Spinner tone="onPrimary" /> : <Icon name="arrow-up" size={20} color={palette.onPrimary} />}
        </Pressable>
      </View>
      <KeyboardSpacer />

      <NameSheet visible={sheet === 'name'} title="Name" initial={entry.name} onClose={() => setSheet(null)} onSave={(name) => save({ name })} />
      <DateSheet
        visible={sheet === 'date'}
        initial={editingDate}
        onClose={() => setSheet(null)}
        onSave={(d) => setDates(editing === null ? [...latest.current.dates, d] : latest.current.dates.map((x, i) => (i === editing ? d : x)))}
        onDelete={editing === null ? undefined : () => void setDates(latest.current.dates.filter((_, i) => i !== editing))}
      />
      <CatchUpSheet
        visible={sheet === 'catch-up'}
        onClose={() => setSheet(null)}
        onSave={(body, daysAgo) => addNote(body, true, daysAgo).catch(() => showToast('Couldn’t save it. Try again.'))}
      />
      <LinkSheet
        visible={sheet === 'link'}
        people={people}
        onClose={() => setSheet(null)}
        onPick={(uid) => void linkPersonNow(entry.contactId!, uid).catch(() => showToast('Couldn’t link them. Try again.'))}
      />
    </Screen>
  );
}
