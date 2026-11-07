import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import InviteLink from '@/app/i/[token]';
import { CirclePickerSheet } from '@/components/circle-choice';
import { InviteSheet } from '@/components/invite-sheet';
import { STARTER_CIRCLES } from '@/lib/addressbook';

let mockSession: { status: string; account?: { userId: string; handle: string } } = { status: 'signedIn', account: { userId: 'me', handle: 'me' } };
const mockRedirect = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ token: 'tok123' }),
  Redirect: ({ href }: { href: unknown }) => {
    mockRedirect(href);
    return null;
  },
}));
jest.mock('@/lib/session', () => ({ useSession: () => mockSession }));
jest.mock('@/api/client', () => ({}));
const mockPending = jest.fn();
jest.mock('@/lib/pending-invite', () => ({ setPendingInvite: (l: string) => mockPending(l) }));
const mockJoin = jest.fn(async (): Promise<'accepted' | 'outgoing'> => 'accepted');
jest.mock('@/lib/friends', () => ({
  ...jest.requireActual('@/lib/friends'),
  previewInvite: async () => ({ userId: 'a', name: 'Ana', handle: 'ana', avatarUrl: null }),
  joinInvite: (...a: unknown[]) => mockJoin(...(a as [])),
}));
const mockToast = jest.fn();
jest.mock('@/lib/toast', () => ({ showToast: (m: string) => mockToast(m) }));
jest.mock('@/lib/dialog', () => ({ showAlert: jest.fn() }));

const book = { circleDefs: STARTER_CIRCLES, contacts: {} };
const account = { userId: 'me', handle: 'me' } as never;

describe('opening an invite link', () => {
  beforeEach(() => jest.clearAllMocks());

  it('signed in: goes straight to adding them to my circles', async () => {
    mockSession = { status: 'signedIn', account: { userId: 'me', handle: 'me' } };
    await render(<InviteLink />);
    expect(mockRedirect).toHaveBeenCalledWith({ pathname: '/search', params: { invite: 'tok123' } });
    expect(mockPending).not.toHaveBeenCalled();
  });

  it('signed out: keeps the link for after signing in', async () => {
    mockSession = { status: 'signedOut' };
    await render(<InviteLink />);
    expect(mockPending).toHaveBeenCalledWith(expect.stringContaining('tok123'));
    expect(mockRedirect).toHaveBeenCalledWith('/welcome');
  });

  it('asks "Add Ana to your circles", says what Ana will see, then connects with the circles picked', async () => {
    const done = jest.fn();
    await render(<InviteSheet account={account} link="https://www.hellocirclo.com/i/tok123" book={book} onClose={done} />);
    expect(await screen.findByText('Add Ana to your circles')).toBeTruthy();
    expect(screen.getByText(/Ana will see your Everyone posts and your posts to the circles you tick/)).toBeTruthy();

    await fireEvent.press(screen.getByRole('checkbox', { name: /Family/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(mockJoin).toHaveBeenCalledWith(account, 'https://www.hellocirclo.com/i/tok123', [1]));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('You and Ana are now connected'));
    expect(done).toHaveBeenCalled();
  });
});

describe('the circle picker for a person', () => {
  it('names them in the explanation', async () => {
    await render(<CirclePickerSheet visible book={book} selected={[]} person="Ben" onDone={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/Ben will see your Everyone posts and your posts to the circles you tick/)).toBeTruthy();
  });
});
