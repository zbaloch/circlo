import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { api, ok } from '@/api/client';
import { AuthScreen } from '@/components/auth-screen';
import { Avatar } from '@/components/avatar';
import { Button, ErrorText, TextField, Title } from '@/components/form';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { describeError } from '@/lib/account';
import { refreshMe, saveProfile, setMe, useMe } from '@/lib/me';
import { discardPicked, uploadAvatar } from '@/lib/media';
import { useSession } from '@/lib/session';

/** Edit my name, bio and photo. They're shown to the people I'm connected with, never to strangers. */
export default function EditProfileScreen() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const me = useMe();
  const [name, setName] = useState(me?.name ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    refreshMe().then(
      (m) => {
        setName((n) => n || (m.name ?? ''));
        setBio((b) => b || m.bio);
      },
      (e) => setError(describeError(e)),
    );
  }, []);

  if (!account) return null;

  const changePhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], exif: false, quality: 1 });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    const picked = { uri: a.uri, type: 'image' as const, width: a.width, height: a.height, mimeType: a.mimeType ?? undefined };
    setPhotoBusy(true);
    setError(undefined);
    try {
      const objectKey = await uploadAvatar(picked);
      setMe(ok(await api.PUT('/v1/me/avatar', { body: { objectKey } })));
    } catch (e) {
      setError(describeError(e));
    } finally {
      discardPicked([picked]);
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true);
    try {
      setMe(ok(await api.DELETE('/v1/me/avatar')));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setPhotoBusy(false);
    }
  };

  return (
    <AuthScreen>
      <Title subtitle="Your people see your name, photo and bio. Nobody else can.">Edit profile</Title>
      <View className="flex-row items-center gap-4">
        <Avatar size="lg" name={name || account.handle} uri={me?.avatarUrl} />
        {photoBusy ? (
          <Spinner />
        ) : (
          <View className="gap-1">
            <Pressable accessibilityRole="button" onPress={changePhoto} className="py-1 active:opacity-60">
              <Text className="font-semibold text-primary dark:text-primary-dark">{me?.avatarUrl ? 'Change photo' : 'Add a photo'}</Text>
            </Pressable>
            {me?.avatarUrl ? (
              <Pressable accessibilityRole="button" onPress={removePhoto} className="py-1 active:opacity-60">
                <Text className="font-semibold text-danger dark:text-danger-dark">Remove photo</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
      <TextField label="Name" placeholder="Optional: shown instead of your @username" value={name} onChangeText={setName} maxLength={50} autoCapitalize="words" />
      <TextField label="Bio" value={bio} onChangeText={setBio} maxLength={160} multiline />
      <ErrorText>{error}</ErrorText>
      <Button
        label="Save"
        loading={busy}
        onPress={async () => {
          setBusy(true);
          setError(undefined);
          try {
            await saveProfile(name, bio);
            router.back();
          } catch (e) {
            setError(describeError(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </AuthScreen>
  );
}
