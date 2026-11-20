import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CircleScreen from '@/app/circle/[n]';
import MatesScreen from '@/app/mates/[id]';
import PrivacySettingsScreen from '@/app/settings/privacy';
import { STARTER_CIRCLES, type AddressBook } from '@/lib/addressbook';
import { matesLine, membersVisibleChange } from '@/lib/circle-mates';

// The first screen rendered in a cold jest worker can take longer than the default 5s.
jest.setTimeout(20_000);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (p: unknown) => mockPush(p), back: jest.fn(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => ({ n: '2', id: 'owner' }),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
const mockSession = { status: 'signedIn', account: { userId: 'me', handle: 'me' } };
jest.mock('@/lib/session', () => ({ useSession: () => mockSession }));
jest.mock('@/api/client', () => ({}));

const mockBook: AddressBook = {
  circleDefs: STARTER_CIRCLES.map((c) => ({ ...c, membersVisible: c.id <= 2 })),
  contacts: {
    owner: { status: 'accepted', displayName: 'Zaheer', handle: 'zaheer', bio: '', avatarUrl: null, circles: [] },
    i: { status: 'accepted', displayName: 'Imran', handle: 'imran', bio: '', avatarUrl: null, circles: [2] },
    z: { status: 'accepted', displayName: 'Zulfi', handle: 'zulfi', bio: '', avatarUrl: null, circles: [2] },
  },
};
jest.mock('@/lib/addressbook', () => ({
  ...jest.requireActual('@/lib/addressbook'),
  loadAddressBook: async () => mockBook,
}));
const mockSetVisible = jest.fn(async () => {});
jest.mock('@/lib/circles', () => ({
  ...jest.requireActual('@/lib/circles'),
  setMembersVisible: (...a: unknown[]) => mockSetVisible(...(a as [])),
}));
const mockMates = [
  { userId: 'a', name: 'Ali', username: 'ali', avatarUrl: null, relation: null },
  { userId: 'b', name: 'Bushra', username: 'bushra', avatarUrl: null, relation: 'outgoing' },
  { userId: 'c', name: 'Chand', username: 'chand', avatarUrl: null, relation: 'accepted' },
  { userId: 'd', name: 'Dua', username: 'dua', avatarUrl: null, relation: 'incoming' },
];
const mockSendRequest = jest.fn(async () => {});
jest.mock('@/lib/circle-mates', () => ({
  ...jest.requireActual('@/lib/circle-mates'),
  loadCircleMates: async () => mockMates,
}));
jest.mock('@/lib/friends', () => ({
  ...jest.requireActual('@/lib/friends'),
  sendRequest: (...a: unknown[]) => mockSendRequest(...(a as [])),
}));
const mockMe = { showInCircles: true };
const mockSetShow = jest.fn(async (_on: boolean) => mockMe);
jest.mock('@/lib/me', () => ({
  useMe: () => mockMe,
  refreshMe: jest.fn(async () => mockMe),
  setShowInCircles: (on: boolean) => mockSetShow(on),
}));
jest.mock('@/lib/blocks', () => ({ refreshBlocked: jest.fn(async () => {}), unblockUser: jest.fn(), useBlockedPeople: () => [] }));
jest.mock('@/lib/device-integrity', () => ({ useIntegrityWarning: () => ({ message: null }) }));
type Btn = { text: string; style?: string; onPress?: () => void };
const mockAlert = jest.fn<void, [string, string | undefined, Btn[] | undefined]>();
jest.mock('@/lib/dialog', () => ({ showAlert: (t: string, m?: string, b?: Btn[]) => mockAlert(t, m, b) }));
const mockToast = jest.fn();
jest.mock('@/lib/toast', () => ({ showToast: (m: string) => mockToast(m) }));

function confirm(text: string) {
  const buttons = mockAlert.mock.calls.at(-1)?.[2] ?? [];
  buttons.find((b) => b.text === text)?.onPress?.();
}

describe('people in the same circle see each other', () => {
  beforeEach(() => jest.clearAllMocks());

  it('names a few people on the profile line', () => {
    expect(matesLine(['Imran'])).toBe('Imran');
    expect(matesLine(['Imran', 'Zulfi'])).toBe('Imran and Zulfi');
    expect(matesLine(['Imran', 'Zulfi', 'Ali'])).toBe('Imran, Zulfi and 1 other');
    expect(matesLine(['Imran', 'Zulfi', 'Ali', 'Bushra'])).toBe('Imran, Zulfi and 2 others');
  });

  it('explains both ways what the circle switch does', () => {
    const on = membersVisibleChange('Close Friends', 2, true);
    expect(on.title).toBe('Let Close Friends see each other?');
    expect(on.message).toMatch(/2 people in Close Friends will see each other on your profile/);
    expect(on.message).toMatch(/never see the circle’s name/);
    const off = membersVisibleChange('Close Friends', 2, false);
    expect(off.title).toBe('Stop Close Friends seeing each other?');
    expect(off.message).toMatch(/stays connected/);
  });

  it('a circle’s screen has the switch, asks before changing it, then confirms with a toast', async () => {
    await render(<CircleScreen />);
    const toggle = await screen.findByRole('switch', { name: 'People in this circle can see each other' });
    expect(toggle.props.accessibilityState.checked).toBe(true);

    await fireEvent.press(toggle);
    expect(mockAlert).toHaveBeenCalledWith('Stop Close Friends seeing each other?', expect.any(String), expect.any(Array));
    await act(async () => confirm('Cancel'));
    expect(mockSetVisible).not.toHaveBeenCalled();

    await fireEvent.press(toggle);
    await act(async () => confirm('Turn off'));
    await waitFor(() => expect(mockSetVisible).toHaveBeenCalledWith(mockSession.account, 2, false));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('People in Close Friends can’t see each other now'));
  });

  it('lists the people I know through a friend, with Connect for those I’m not connected to, and no circle anywhere', async () => {
    await render(<MatesScreen />);
    expect(await screen.findByText('Ali')).toBeTruthy();
    expect(screen.queryByText(/Close Friends|Family/)).toBeNull();

    // Requested and Respond for pending requests; nothing for friends.
    expect(screen.getByRole('button', { name: 'Request sent to Bushra' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Respond to Dua' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/friend/[id]', params: { id: 'd' } });
    expect(screen.queryByRole('button', { name: /Connect with Chand/ })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Connect with Ali' }));
    await waitFor(() => expect(mockSendRequest).toHaveBeenCalledWith(mockSession.account, 'a'));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Request sent to Ali'));
  });

  it('anyone can hide themselves in Privacy and safety', async () => {
    await render(<PrivacySettingsScreen />);
    const toggle = await screen.findByRole('switch', { name: 'Show me to others in the same circles' });
    expect(toggle.props.accessibilityState.checked).toBe(true);
    await fireEvent.press(toggle);
    await waitFor(() => expect(mockSetShow).toHaveBeenCalledWith(false));
    // The old "only people you invite" promise is gone: it's no longer the only way.
    expect(screen.queryByText('Only people you invite can add you')).toBeNull();
  });
});
