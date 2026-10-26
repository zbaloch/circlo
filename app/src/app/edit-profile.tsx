import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, TextField, Title } from '@/components/form';
import { describeError } from '@/lib/account';
import { ensureEpoch, loadMyProfile, saveMyProfile } from '@/lib/friends';
import { useSession } from '@/lib/session';

/** Edit my profile; it's encrypted on this phone with a key only my friends hold. */
export default function EditProfileScreen() {
  const session = useSession();
  const account = session.status === 'signedIn' ? session.account : null;
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!account) return;
    ensureEpoch(account)
      .then(() => loadMyProfile(account))
      .then(
        (p) => {
          if (p) {
            setDisplayName(p.displayName);
            setBio(p.bio);
          }
        },
        (e) => setError(describeError(e)),
      );
  }, [account]);

  if (!account) return null;

  return (
    <AuthScreen>
      <Title subtitle="Encrypted on this phone. Only your friends can read it; Halqo can’t.">Edit profile</Title>
      <TextField label="Display name" value={displayName} onChangeText={setDisplayName} maxLength={50} autoCapitalize="words" />
      <TextField label="Bio" value={bio} onChangeText={setBio} maxLength={160} multiline />
      <ErrorText>{error}</ErrorText>
      <Button
        label="Save"
        loading={busy}
        disabled={!displayName.trim()}
        onPress={async () => {
          setBusy(true);
          setError(undefined);
          try {
            await saveMyProfile(account, { displayName: displayName.trim(), bio: bio.trim(), handle: account.handle });
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
