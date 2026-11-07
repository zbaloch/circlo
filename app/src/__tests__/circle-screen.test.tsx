import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CircleScreen from '@/app/circle/[n]';
import { STARTER_CIRCLES, type AddressBook } from '@/lib/addressbook';
import { membershipChange } from '@/lib/circles';

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (p: unknown) => mockPush(p), back: () => mockBack(), canGoBack: () => true, replace: jest.fn() },
  useLocalSearchParams: () => ({ n: '1' }),
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
const mockSession = { status: 'signedIn', account: { userId: 'me', handle: 'me' } };
jest.mock('@/lib/session', () => ({ useSession: () => mockSession }));
jest.mock('@/api/client', () => ({}));

const mockBook: AddressBook = {
  circleDefs: STARTER_CIRCLES,
  contacts: {
    m: { status: 'accepted', displayName: 'Ana', handle: 'ana', bio: 'Baker and hiker', avatarUrl: null, circles: [1, 2] },
    i: { status: 'accepted', displayName: 'Ben Carter', handle: 'bencarter', bio: 'Cyclist', avatarUrl: null, circles: [2] },
  },
};
jest.mock('@/lib/addressbook', () => ({
  ...jest.requireActual('@/lib/addressbook'),
  loadAddressBook: async () => mockBook,
}));
const mockSetCircles = jest.fn(async () => {});
const mockDelete = jest.fn(async () => {});
jest.mock('@/lib/circles', () => ({
  ...jest.requireActual('@/lib/circles'),
  setCircles: (...a: unknown[]) => mockSetCircles(...(a as [])),
  deleteCircle: (...a: unknown[]) => mockDelete(...(a as [])),
}));
type Btn = { text: string; style?: string; onPress?: () => void };
const mockAlert = jest.fn<void, [string, string | undefined, Btn[] | undefined]>();
jest.mock('@/lib/dialog', () => ({ showAlert: (t: string, m?: string, b?: Btn[]) => mockAlert(t, m, b) }));
const mockToast = jest.fn();
jest.mock('@/lib/toast', () => ({ showToast: (m: string) => mockToast(m) }));

/** Presses the dialog's button named `text`. */
function confirm(text: string) {
  const buttons = mockAlert.mock.calls.at(-1)?.[2] ?? [];
  buttons.find((b) => b.text === text)?.onPress?.();
}

describe('a circle’s screen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists people like a followers list: name, @handle and bio; tapping one opens their profile', async () => {
    await render(<CircleScreen />);
    expect(await screen.findByText('Ana')).toBeTruthy();
    expect(screen.getByText('@ana')).toBeTruthy();
    expect(screen.getByText('Baker and hiker')).toBeTruthy();
    // Ben isn't in Family: he's under "Add to this circle", with his bio too.
    expect(screen.getByText('Cyclist')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: /Ana, @ana/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/friend/[id]', params: { id: 'm' } });
  });

  it('asks before removing someone, explains what it means, then confirms with a toast', async () => {
    await render(<CircleScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Remove Ana from Family' }));
    expect(mockAlert).toHaveBeenCalledWith('Remove Ana from Family?', expect.stringMatching(/no longer see/), expect.any(Array));
    expect(mockSetCircles).not.toHaveBeenCalled();

    await act(async () => confirm('Remove'));
    await waitFor(() => expect(mockSetCircles).toHaveBeenCalledWith(mockSession.account, 'm', [2]));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Ana removed from Family'));
  });

  it('asks before adding someone, then confirms with a toast', async () => {
    await render(<CircleScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Add Ben Carter to Family' }));
    expect(mockAlert).toHaveBeenCalledWith('Add Ben Carter to Family?', expect.stringMatching(/earlier/), expect.any(Array));

    await act(async () => confirm('Cancel'));
    expect(mockSetCircles).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole('button', { name: 'Add Ben Carter to Family' }));
    await act(async () => confirm('Add'));
    await waitFor(() => expect(mockSetCircles).toHaveBeenCalledWith(mockSession.account, 'i', [2, 1]));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Ben Carter added to Family'));
  });

  it('leads with "Done", back to my circles', async () => {
    await render(<CircleScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Done' }));
    expect(mockBack).toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('keeps "Delete circle" as a quiet link at the bottom, still behind a confirmation', async () => {
    await render(<CircleScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete circle' }));
    expect(mockAlert).toHaveBeenCalledWith('Delete Family?', expect.any(String), expect.any(Array));
    await act(async () => confirm('Delete'));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(mockSession.account, 1));
  });
});

describe('membershipChange', () => {
  it('says what adding and removing mean, and that nobody is told', () => {
    const add = membershipChange('Ana', 'Family', true);
    expect(add).toMatchObject({ title: 'Add Ana to Family?', confirm: 'Add', done: 'Ana added to Family' });
    expect(add.message).toMatch(/earlier/);
    expect(add.message).toMatch(/aren’t told/);

    const remove = membershipChange('Ana', 'Family', false);
    expect(remove).toMatchObject({ title: 'Remove Ana from Family?', confirm: 'Remove', done: 'Ana removed from Family' });
    expect(remove.message).toMatch(/Everyone/);
    expect(remove.message).toMatch(/aren’t told/);
  });
});
