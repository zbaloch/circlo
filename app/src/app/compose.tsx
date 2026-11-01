import { Icon } from '@/components/ui/icon';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { BackHandler, Platform, Pressable, ScrollView, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AudiencePicker, audienceLine } from '@/components/audience-sheet';
import { Avatar } from '@/components/avatar';
import { CharRing } from '@/components/char-ring';
import { Button, ErrorText } from '@/components/form';
import { describeError } from '@/lib/account';
import { loadAddressBook, type AddressBook, type Audience } from '@/lib/addressbook';
import { audienceLabel, ONLY_ME } from '@/lib/circles';
import { discardPicked, MAX_IMAGES, type PickedMedia } from '@/lib/media';
import { enqueuePost } from '@/lib/outbox';
import { MAX_POST_CHARS, validateDraft } from '@/lib/posts';
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

/**
 * The compose sheet (PLAN.md 2A), in two steps: write (text with counter ring, up to 4 photos or 1 video), then choose
 * who can see it. Step 2 starts with nothing chosen, so every post's audience is a deliberate choice.
 */
export default function ComposeScreen() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const palette = usePalette();
  const [book, setBook] = useState<AddressBook | null>(null);
  const [step, setStep] = useState<'write' | 'audience'>('write');
  const [audience, setAudience] = useState<Audience | null>(null);
  const [text, setText] = useState('');
  const [media, setMedia] = useState<PickedMedia[]>([]);
  const [error, setError] = useState<string>();

  // Reload circles on every visit (the screen stays mounted), so one made since the last post shows up.
  useFocusEffect(
    useCallback(() => {
      if (!account) return;
      loadAddressBook(account).then(setBook, (e) => setError(describeError(e)));
    }, [account]),
  );

  // Android's back button goes from choosing the audience back to the text, not out of compose.
  useFocusEffect(
    useCallback(() => {
      if (step !== 'audience') return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        setStep('write');
        return true;
      });
      return () => sub.remove();
    }, [step]),
  );

  const hasVideo = media.some((m) => m.type === 'video');
  const canAdd = !hasVideo && media.length < MAX_IMAGES;
  const content = { text: text.trim(), media };
  const used = [...text].length;
  // Step 1 checks only the content; the audience is chosen in step 2.
  const writable = !!book && validateDraft({ ...content, audience: ONLY_ME }, book) === null;
  const postable = !!book && !!audience && validateDraft({ ...content, audience }, book) === null;

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

  // Drawer screens stay mounted between visits, so the next post starts from an empty composer.
  const reset = () => {
    setText('');
    setMedia([]);
    setError(undefined);
    setAudience(null);
    setStep('write');
  };

  const post = () => {
    if (!account || !audience || !postable) return;
    enqueuePost(account, { ...content, audience });
    reset();
    router.back();
  };

  if (step === 'audience' && book) {
    return (
      <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
        <View className="flex-row items-center gap-3 px-4 py-2">
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => setStep('write')} hitSlop={8} className="py-2">
            <Icon name="arrow-back" size={22} color={palette.ink} />
          </Pressable>
          <Text accessibilityRole="header" className="text-xl font-bold text-ink dark:text-ink-dark">
            Who can see this?
          </Text>
        </View>
        <ScrollView className="flex-1" contentContainerClassName="pb-4">
          <View className="mx-4 mb-2 gap-1 rounded-2xl bg-surface-raised px-4 py-3 dark:bg-surface-raised-dark">
            {content.text ? (
              <Text numberOfLines={3} className="text-base text-ink dark:text-ink-dark">
                {content.text}
              </Text>
            ) : null}
            {media.length ? (
              <Text className="text-sm text-muted dark:text-muted-dark">
                {hasVideo ? '1 video' : `${media.length} ${media.length === 1 ? 'photo' : 'photos'}`}
              </Text>
            ) : null}
          </View>
          <AudiencePicker book={book} selected={audience} onChange={setAudience} />
        </ScrollView>
        <View className="gap-2 border-t border-border px-4 py-3 dark:border-border-dark">
          <Text className="text-center text-sm text-muted dark:text-muted-dark">
            {audience ? `${audienceLabel(book, audience)} · ${audienceLine(book, audience)}` : 'Choose who can see this post.'}
          </Text>
          <Button label="Post" disabled={!postable} onPress={post} />
        </View>
      </SafeAreaView>
    );
  }

  // Phones: pinned to the bottom, so it rides just above the keyboard (as on X). The web has no on-screen keyboard:
  // there it sits right under the text and photos, lined up with them.
  const web = Platform.OS === 'web';
  const toolbar = (
    <View className={`flex-row items-center gap-5 border-t border-border py-3 dark:border-border-dark ${web ? 'ml-12' : 'px-4'}`}>
      <Pressable accessibilityRole="button" accessibilityLabel="Add photos or video" disabled={!canAdd} onPress={() => pick(false)} className={canAdd ? '' : 'opacity-40'}>
        <Icon name="image-outline" size={24} color={palette.primary} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Take a photo" disabled={!canAdd} onPress={() => pick(true)} className={canAdd ? '' : 'opacity-40'}>
        <Icon name="camera-outline" size={24} color={palette.primary} />
      </Pressable>
      <View className="flex-1" />
      <CharRing used={used} limit={MAX_POST_CHARS} />
    </View>
  );

  return (
    <SafeAreaView className="flex-1 bg-surface dark:bg-surface-dark">
      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <View className="flex-row items-center justify-between px-4 py-2">
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              discardPicked(media);
              reset();
              router.back();
            }}
            className="py-2">
            <Text className="text-base text-ink dark:text-ink-dark">Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !writable }}
            disabled={!writable}
            onPress={() => setStep('audience')}
            className={`rounded-full bg-primary px-5 py-2 active:bg-primary-pressed dark:bg-primary-dark dark:active:bg-primary-pressed-dark ${writable ? '' : 'opacity-50'}`}>
            <Text className="text-base font-bold text-on-primary dark:text-on-primary-dark">Next</Text>
          </Pressable>
        </View>

        <ScrollView testID="compose-body" className="flex-1" contentContainerClassName="gap-3 px-4 pb-4" keyboardShouldPersistTaps="handled">
          <View className="flex-row gap-3">
            <Avatar id={account?.userId} name={account?.handle} />
            <View className="flex-1 gap-2">
              <TextInput
                accessibilityLabel="Post text"
                autoFocus
                multiline
                placeholder="What's happening?"
                placeholderTextColor={palette.muted}
                value={text}
                onChangeText={setText}
                // Android centres multiline text and pads it by default: start at the top, with no line height
                // (Android adds it above the text). 4 pt puts the first line's centre on the 40 pt avatar's, as
                // measured on screen; Android snaps the text, so 5 pt already lands about 5 pt too low.
                textAlignVertical="top"
                className="min-h-24 p-0 pt-1 text-lg text-ink dark:text-ink-dark"
              />
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
          {web ? toolbar : null}
          <ErrorText>{error}</ErrorText>
        </ScrollView>

        {web ? null : toolbar}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
