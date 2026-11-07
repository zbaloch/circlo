import { useEffect, useState } from 'react';

import { CirclePickerSheet } from '@/components/circle-choice';
import { describeError } from '@/lib/account';
import type { AddressBook } from '@/lib/addressbook';
import { showAlert } from '@/lib/dialog';
import { InviteError, joinInvite, previewInvite } from '@/lib/friends';
import type { StoredAccount } from '@/lib/keystore';
import { showToast } from '@/lib/toast';

function problem(e: unknown) {
  return e instanceof InviteError ? e.message : describeError(e);
}

/**
 * An invite link that opened the app while signed in: straight to "Add Ana to your circles", saying what Ana will see
 * (my Everyone posts and my posts to the circles ticked), then connected with a toast. Nothing is joined until
 * Connect is pressed; closing the sheet leaves the invite unused.
 */
export function InviteSheet({ account, link, book, onClose, onJoined }: {
  account: StoredAccount;
  link: string;
  book: AddressBook;
  onClose: () => void;
  onJoined?: () => void;
}) {
  const [from, setFrom] = useState<{ link: string; name: string } | null>(null);

  useEffect(() => {
    let live = true;
    previewInvite(link).then(
      (p) => {
        if (live) setFrom({ link, name: p.name || `@${p.handle}` });
      },
      (e) => {
        if (live) showAlert('Couldn’t use this invite', problem(e));
      },
    );
    return () => {
      live = false;
    };
  }, [link]);

  if (!from || from.link !== link) return null;
  const name = from.name;
  return (
    <CirclePickerSheet
      visible
      book={book}
      selected={[]}
      person={name}
      title={`Add ${name} to your circles`}
      confirmLabel="Connect"
      onClose={onClose}
      onDone={(ids) =>
        joinInvite(account, link, ids).then(
          (status) => {
            showToast(status === 'accepted' ? `You and ${name} are now connected` : 'Request sent. You’ll see their profile once they accept.');
            onJoined?.();
          },
          (e) => showAlert('Couldn’t connect', problem(e)),
        )
      }
    />
  );
}
