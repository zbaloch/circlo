import { Icon } from '@/components/ui/icon';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudienceSheet, audienceLine } from '@/components/audience-sheet';
import { Avatar } from '@/components/avatar';
import { CharRing } from '@/components/char-ring';
import { ErrorText } from '@/components/form';
import { describeError } from '@/lib/account';
import { CLOSE_FRIENDS, loadAddressBook, type AddressBook } from '@/lib/addressbook';
import { labelOf } from '@/lib/circles';
import { discardPicked, MAX_IMAGES, type PickedMedia } from '@/lib/media';
import { enqueuePost } from '@/lib/outbox';
import { defaultCircle, MAX_POST_CHARS, validateDraft } from '@/lib/posts';
import { useSession } from '@/lib/session';
import { usePalette } from '@/theme/use-palette';
import { Text, TextInput } from '@/components/ui/text';

function toPicked(a: ImagePicker.ImagePickerAsset): PickedMedia {
  return {
    uri: a.uri,
    type: a.type === 'video' ? 'video' : 'image',
    width: a.width,
    height: a.height,
    durationMs: a.duration ?? undefined,
    mimeType: a.mimeType ?? undefined,
  };
}

/** The compose sheet (PLAN.md 2A): audience chip, text with counter ring, up to 4 photos or 1 video. */
export default function ComposeScreen() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const palette = usePalette();
  const [book, setBook] = useState<AddressBook | null>(null);
  const [circle, setCircle] = useState(1);
  const [text, setText] = useState('');
  const [media, setMedia] = useState<PickedMedia[]>([]);
  const [sheet, setSheet] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!account) return;
    loadAddressBook(account).then(
      (b) => {
        setBook(b);
        setCircle(defaultCircle(b));
      },
      (e) => setError(describeError(e)),
    );
  }, [account]);

  const hasVideo = media.some((m) => m.type === 'video');
  const canAdd = !hasVideo && media.length < MAX_IMAGES;
  const draft = { text: text.trim(), circle, media };
  const used = [...text].length;
  const postable = validateDraft(draft) === null;

  const pick = async (camera: boolean) => {
    setError(undefined);
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: camera ? ['images'] : media.length ? ['images'] : ['images', 'videos'],
      allowsMultipleSelection: !camera,
      selectionLimit: MAX_IMAGES - media.length,
      exif: false,
      quality: 1,
    };
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : { granted: true };
    if (!perm.granted) return setError('Camera permission is needed to take a photo.');
    const res = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (res.canceled) return;
    const picked = res.assets.map(toPicked);
    const video = picked.find((p) => p.type === 'video');
    setMedia(video ? [video] : [...media, ...picked.filter((p) => p.type === 'image')].slice(0, MAX_IMAGES));
  };

  const post = () => {
    if (!account || !postable) return;
    enqueuePost(account, draft);
    router.back();
  };

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <View className="flex-row items-center justify-between px-4 py-2">
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              discardPicked(media);
              router.back();
            }}
            className="py-2">
            <Text className="text-base text-ink dark:text-ink-dark">Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !postable }}
            disabled={!postable}
            onPress={post}
            className={`rounded-full bg-primary px-5 py-2 active:bg-primary-pressed dark:bg-primary-dark dark:active:bg-primary-pressed-dark ${postable ? '' : 'opacity-50'}`}>
            <Text className="text-base font-bold text-on-primary dark:text-on-primary-dark">Post</Text>
          </Pressable>
        </View>

        <ScrollView className="flex-1" contentContainerClassName="gap-3 px-4 pb-4" keyboardShouldPersistTaps="handled">
          <View className="flex-row gap-3">
            <Avatar name={account?.handle} />
            <View className="flex-1 gap-2">
              {book ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Audience: ${labelOf(book, circle)}. ${audienceLine(book, circle)}`}
                  onPress={() => setSheet(true)}
                  className="flex-row items-center gap-1 self-start rounded-full border border-primary px-3 py-1 dark:border-primary-dark">
                  <Icon name={circle === 1 ? 'lock-closed' : circle === CLOSE_FRIENDS ? 'star' : 'people'} size={14} color={palette.primary} />
                  <Text className="text-sm font-bold text-primary dark:text-primary-dark">{labelOf(book, circle)}</Text>
                  <Icon name="chevron-down" size={14} color={palette.primary} />
                </Pressable>
              ) : null}
              <TextInput
                accessibilityLabel="Post text"
                autoFocus
                multiline
                placeholder="What's happening?"
                placeholderTextColor={palette.muted}
                value={text}
                onChangeText={setText}
                className="min-h-24 text-lg text-ink dark:text-ink-dark"
              />
              {book ? <Text className="text-sm text-muted dark:text-muted-dark">{audienceLine(book, circle)}</Text> : null}
            </View>
          </View>

          {media.length ? (
            <ScrollView horizontal contentContainerClassName="gap-2 pl-12">
              {media.map((m, i) => (
                <View key={m.uri} className="relative">
                  <Image source={{ uri: m.uri }} className="h-28 w-28 rounded-2xl bg-surface-raised dark:bg-surface-raised-dark" contentFit="cover" />
                  {m.type === 'video' ? (
                    <View className="absolute bottom-1 left-1 rounded-full bg-black/60 px-2 py-0.5">
                      <Icon name="videocam" size={14} color="#FFFFFF" />
                    </View>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove"
                    onPress={() => {
                      discardPicked([m]);
                      setMedia(media.filter((_, j) => j !== i));
                    }}
                    className="absolute right-1 top-1 h-7 w-7 items-center justify-center rounded-full bg-black/60">
                    <Icon name="close" size={16} color="#FFFFFF" />
                  </Pressable>
                  {i > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Move earlier"
                      onPress={() => setMedia([...media.slice(0, i - 1), m, media[i - 1], ...media.slice(i + 1)])}
                      className="absolute left-1 top-1 h-7 w-7 items-center justify-center rounded-full bg-black/60">
                      <Icon name="chevron-back" size={16} color="#FFFFFF" />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          ) : null}
          <ErrorText>{error}</ErrorText>
        </ScrollView>

        <View className="flex-row items-center gap-5 border-t border-border px-4 py-3 dark:border-border-dark">
          <Pressable accessibilityRole="button" accessibilityLabel="Add photos or video" disabled={!canAdd} onPress={() => pick(false)} className={canAdd ? '' : 'opacity-40'}>
            <Icon name="image-outline" size={24} color={palette.primary} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Take a photo" disabled={!canAdd} onPress={() => pick(true)} className={canAdd ? '' : 'opacity-40'}>
            <Icon name="camera-outline" size={24} color={palette.primary} />
          </Pressable>
          <View className="flex-1" />
          <CharRing used={used} limit={MAX_POST_CHARS} />
        </View>
      </KeyboardAvoidingView>
      {book ? <AudienceSheet visible={sheet} book={book} selected={circle} onSelect={setCircle} onClose={() => setSheet(false)} /> : null}
    </SafeAreaView>
  );
}
