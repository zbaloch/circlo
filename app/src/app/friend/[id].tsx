import { Icon, type IconName } from '@/components/ui/icon';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { CircleBadge } from '@/components/circle-badge';
import { memberLine } from '@/components/circle-choice';
import { ErrorText } from '@/components/form';
import { ProfileFeed } from '@/components/profile-feed';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { describeError } from '@/lib/account';
import { loadAddressBook, type AddressBook, type Contact } from '@/lib/addressbook';
import { blockUser } from '@/lib/blocks';
import { audienceLabel, circleDefs, circlesOf, setCircles, unfriend } from '@/lib/circles';
import { showAlert } from '@/lib/dialog';
import { loadProfile, type Profile } from '@/lib/friends';
import { displayName, useConnections } from '@/lib/use-connections';
import { usePalette } from '@/theme/use-palette';

/**
 * A friend's profile, laid out like X / Bluesky: avatar, name, bio, posts.
 * Everything about MY relationship with them (their circles, removing them) sits behind one button beside the avatar
 * showing their circles. It is author-only: they are never told and never see a label (PLAN.md 2A).
 */
export default function FriendScreen() {
  // `circles=1`: opened to choose their circles (someone who just joined with my link).
  const { id, circles: chooseCircles } = useLocalSearchParams<{ id: string; circles?: string }>();
  const openOnArrival = useRef(chooseCircles === '1');
  const palette = usePalette();
  const { account, connections, refresh } = useConnections();
  const [book, setBook] = useState<AddressBook | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    loadProfile(id).then(setProfile, () => {});
  }, [id]);

  const reloadBook = useCallback(() => {
    // The screen stays mounted between visits: reopen with the sheet closed, unless sent here to choose circles.
    setOpen(openOnArrival.current);
    openOnArrival.current = false;
    if (account) void loadAddressBook(account).then(setBook);
  }, [account]);
  useFocusEffect(reloadBook);

  const c = connections?.find((x) => x.userId === id);
  if (!account || !c) return null;
  const contact = book?.contacts[c.userId];
  const name = displayName(c);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    showAlert(
      `Remove ${name}?`,
      `They won’t see your posts any more, including earlier ones, and they aren’t told. Your invite link won’t work for them again; to reconnect, you’d open theirs.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => run(async () => { setOpen(false); await unfriend(account, c.userId); await refresh(); router.back(); }) },
      ],
    );

  const block = () =>
    showAlert(`Block ${name}?`, 'You’ll stop being connected. They can’t send you requests or see anything new you post, and their messages are hidden. They aren’t told.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: () => run(async () => { setOpen(false); await blockUser(account, c.userId, name, c.profile.handle); await refresh(); router.back(); }) },
    ]);
  const report = () => {
    setOpen(false);
    router.push({ pathname: '/report/[id]', params: { id: c.userId, kind: 'user' } });
  };

  // The button beside the avatar: their circles ("Everyone" if none: they see my Everyone posts).
  const theirCircles = contact && book ? circlesOf(book, contact) : [];
  const circlesText = book ? audienceLabel(book, theirCircles.length ? { kind: 'circles', ids: theirCircles } : { kind: 'everyone' }) : '';
  const circleButton =
    contact && book ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Circles: ${circlesText}. Change`}
        onPress={() => setOpen(true)}
        className="flex-row items-center gap-1.5 rounded-full border border-border px-4 py-2 active:bg-surface-raised dark:border-border-dark dark:active:bg-surface-raised-dark">
        <Text className="text-[15px] font-bold text-ink dark:text-ink-dark">{circlesText}</Text>
        {busy ? <Spinner /> : <Icon name="chevron-down" size={16} color={palette.ink} />}
      </Pressable>
    ) : null;

  const below = (
    <View className="gap-2">
      <ErrorText>{error}</ErrorText>
      {contact && book ? (
        <FriendSheet
          visible={open}
          name={name}
          book={book}
          contact={contact}
          busy={busy}
          onClose={() => setOpen(false)}
          onToggle={(id, on) =>
            run(async () => {
              const current = circlesOf(book, contact);
              await setCircles(account, c.userId, on ? [...current, id] : current.filter((x) => x !== id));
              reloadBook();
            })
          }
          onPreview={() => { setOpen(false); router.push({ pathname: '/preview/[id]', params: { id: c.userId } }); }}
          onRemove={remove}
          onReport={report}
          onBlock={block}
        />
      ) : null}
    </View>
  );

  if (c.status === 'accepted') {
    return (
      <ProfileFeed
        account={account}
        userId={c.userId}
        name={name}
        handle={c.profile.handle}
        bio={profile?.bio}
        avatarUrl={profile?.avatarUrl ?? c.profile.avatarUrl}
        headerRight={circleButton ?? undefined}
        actions={below}
      />
    );
  }

  return (
    <ScrollView className="flex-1 bg-surface dark:bg-surface-dark" contentContainerClassName="items-center gap-3 px-6 pb-10 pt-8">
      <Avatar size="lg" id={c.userId} name={name} uri={profile?.avatarUrl ?? c.profile.avatarUrl} />
      <Text className="text-2xl font-bold text-ink dark:text-ink-dark">{name}</Text>
      <Text className="text-muted dark:text-muted-dark">@{c.profile.handle}</Text>
      {profile?.bio ? <Text className="text-center text-base text-ink dark:text-ink-dark">{profile.bio}</Text> : null}
      <Text className="text-muted dark:text-muted-dark">Request pending</Text>
      {circleButton}
      <View className="w-full">{below}</View>
      <View className="flex-row gap-6 pt-2">
        <Pressable accessibilityRole="button" onPress={report} disabled={busy} className="active:opacity-60">
          <Text className="font-semibold text-danger dark:text-danger-dark">Report</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={block} disabled={busy} className="active:opacity-60">
          <Text className="font-semibold text-danger dark:text-danger-dark">Block</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

type SheetProps = {
  visible: boolean;
  name: string;
  book: AddressBook;
  contact: Contact;
  busy: boolean;
  onClose: () => void;
  onToggle: (circle: number, on: boolean) => void;
  onPreview: () => void;
  onRemove: () => void;
  onReport: () => void;
  onBlock: () => void;
};

/** One sheet for everything about my relationship with this friend. Only I ever see it. */
function FriendSheet({ visible, name, book, contact, busy, onClose, onToggle, onPreview, onRemove, onReport, onBlock }: SheetProps) {
  const palette = usePalette();
  const row = (icon: IconName, label: string, onPress: () => void, danger = false) => (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={busy} className="flex-row items-center gap-3 px-5 py-3.5 active:bg-surface-raised dark:active:bg-surface-raised-dark">
      <Icon name={icon} size={20} color={danger ? palette.danger : palette.ink} />
      <Text className={`text-base ${danger ? 'font-semibold text-danger dark:text-danger-dark' : 'text-ink dark:text-ink-dark'}`}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" className="flex-1 bg-black/40" onPress={onClose} />
      <View className="max-h-[85%] rounded-t-3xl bg-surface pb-6 dark:bg-surface-dark">
        <View className="items-center py-3">
          <View className="h-1 w-10 rounded-full bg-border dark:bg-border-dark" />
        </View>
        <View className="flex-row items-center gap-2 px-5 pb-1">
          <Text className="flex-1 text-xl font-bold text-ink dark:text-ink-dark">{name}</Text>
          {busy ? <Spinner /> : null}
        </View>
        <View className="flex-row items-center gap-1.5 px-5 pb-2">
          <Icon name="lock-closed" size={12} color={palette.muted} />
          <Text className="text-sm text-muted dark:text-muted-dark">Only you see this. {name} is never told.</Text>
        </View>
        <ScrollView>
          <Text className="px-5 pb-1 pt-2 text-sm font-bold uppercase text-muted dark:text-muted-dark">Circles</Text>
          <Text className="px-5 pb-1 text-sm text-muted dark:text-muted-dark">
            {name} sees your Everyone posts, plus posts to the circles you put them in.
          </Text>
          {circleDefs(book).map((c) => {
            const on = circlesOf(book, contact).includes(c.id);
            return (
              <Pressable
                key={c.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                disabled={busy}
                onPress={() => onToggle(c.id, !on)}
                className="flex-row items-center gap-3 px-5 py-2.5 active:bg-surface-raised dark:active:bg-surface-raised-dark">
                <CircleBadge book={book} id={c.id} small />
                <View className="flex-1">
                  <Text className="text-base text-ink dark:text-ink-dark">{c.name}</Text>
                  <Text className="text-sm text-muted dark:text-muted-dark">{memberLine(book, c.id)}</Text>
                </View>
                <Icon name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? palette.primary : palette.muted} />
              </Pressable>
            );
          })}
          <View className="mx-5 my-2 h-px bg-border dark:bg-border-dark" />
          {row('eye-outline', `See what ${name} can see`, onPreview)}
          {row('person-remove-outline', `Remove ${name}`, onRemove, true)}
          {row('flag-outline', `Report ${name}`, onReport, true)}
          {row('ban-outline', `Block ${name}`, onBlock, true)}
        </ScrollView>
      </View>
    </Modal>
  );
}
