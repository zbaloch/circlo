import { Redirect, router } from 'expo-router';
import { useMemo, useState } from 'react';

import { usePreventScreenCapture } from 'expo-screen-capture';

import { AuthScreen } from '@/components/auth-screen';
import { Button, ErrorText, TextField, Title } from '@/components/form';
import { describeError, pickConfirmPositions, wordsMatch } from '@/lib/account';
import { useSession } from '@/lib/session';
import { pendingSignup, setPendingSignup } from '@/lib/signup-store';

/** Confirms three words of the phrase, then finishes signup (uploads keys and encrypted backups). */
export default function ConfirmPhraseScreen() {
  // Recovery words must never end up in screenshots, recordings or the recent-apps preview.
  usePreventScreenCapture('confirm-phrase');
  const signup = pendingSignup();
  const { signIn } = useSession();
  const positions = useMemo(() => pickConfirmPositions(), []);
  const [answers, setAnswers] = useState(['', '', '']);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);

  if (!signup) return <Redirect href="/signup" />;

  const submit = async () => {
    setError(undefined);
    if (!wordsMatch(signup.words, positions, answers)) {
      setError('Those words don’t match. Check your written copy.');
      return;
    }
    setBusy(true);
    try {
      const account = await signup.finish();
      setPendingSignup(null);
      signIn(account);
    } catch (e) {
      setError(describeError(e));
      if ((e as { code?: string })?.code === 'registration_expired') {
        // Nothing was saved; this signup can't be finished any more, so offer a clean restart.
        setPendingSignup(null);
        setExpired(true);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthScreen>
      <Title subtitle="To make sure your copy is right, enter these words from your recovery phrase.">Check your phrase</Title>
      {positions.map((p, i) => (
        <TextField
          key={p}
          label={`Word ${p + 1}`}
          value={answers[i]}
          onChangeText={(t) => setAnswers((a) => a.map((v, j) => (j === i ? t : v)))}
        />
      ))}
      <ErrorText>{error}</ErrorText>
      {expired ? (
        <Button label="Start again" onPress={() => router.replace('/signup')} />
      ) : (
        <Button label="Finish" onPress={submit} loading={busy} />
      )}
    </AuthScreen>
  );
}
