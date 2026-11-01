import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Platform } from 'react-native';

import ComposeScreen from '@/app/compose';

// The drawer keeps compose mounted; each test opens it again by calling the focus callbacks the screen registered.
let mockFocus: (() => void)[] = [];
const book = (names: string[]) => ({
  v: 1,
  myEpochs: [],
  contacts: {},
  circleDefs: names.map((name, i) => ({ id: i + 1, name })),
  // Older builds pre-selected this; the composer must not.
  lastAudience: { kind: 'circles', ids: [1] },
});

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useFocusEffect: (cb: () => void) => {
    mockFocus.push(cb);
  },
}));
jest.mock('react-native-keyboard-controller', () => ({ KeyboardAvoidingView: jest.requireActual('react-native').View }));
jest.mock('@/lib/addressbook', () => ({ loadAddressBook: jest.fn() }));
jest.mock('@/lib/outbox', () => ({ enqueuePost: jest.fn() }));
jest.mock('@/lib/media', () => ({ discardPicked: jest.fn(), MAX_IMAGES: 4 }));
jest.mock('@/lib/session', () => ({ useSession: () => ({ status: 'signedIn', account: { userId: 'me', handle: 'me' } }) }));

const open = async () => {
  const callbacks = mockFocus;
  mockFocus = [];
  await act(async () => callbacks.forEach((cb) => cb()));
};
const write = async (text: string) => {
  await fireEvent.changeText(screen.getByLabelText('Post text'), text);
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
};

beforeEach(() => {
  mockFocus = [];
  jest.clearAllMocks();
});

describe('compose screen', () => {
  it('asks who can see the post every time, with nothing chosen up front', async () => {
    const { loadAddressBook } = jest.requireMock('@/lib/addressbook');
    const { enqueuePost } = jest.requireMock('@/lib/outbox');
    loadAddressBook.mockResolvedValue(book(['Family', 'Work']));
    await render(<ComposeScreen />);
    await open();

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await write('Dinner at mum’s');
    expect(screen.getByText('Who can see this?')).toBeTruthy();
    expect(screen.getByText('Choose who can see this post.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();

    await fireEvent.press(screen.getByRole('checkbox', { name: /Family/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Post' }));
    expect(enqueuePost).toHaveBeenCalledWith(expect.anything(), { text: 'Dinner at mum’s', media: [], audience: { kind: 'circles', ids: [1] } });

    // The next post starts from an empty step 1, and step 2 again has nothing chosen.
    await open();
    expect(screen.getByLabelText('Post text').props.value).toBe('');
    await write('Lunch');
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled();
  });

  it('can go back to edit the text, keeping it', async () => {
    const { loadAddressBook } = jest.requireMock('@/lib/addressbook');
    loadAddressBook.mockResolvedValue(book(['Family']));
    await render(<ComposeScreen />);
    await open();
    await write('Draft');
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Post text').props.value).toBe('Draft');
  });

  it('shows a circle made since it was last opened', async () => {
    const { loadAddressBook } = jest.requireMock('@/lib/addressbook');
    loadAddressBook.mockResolvedValueOnce(book(['Family'])).mockResolvedValue(book(['Family', 'Book club']));
    await render(<ComposeScreen />);
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));

    await open();
    await write('Next meeting?');
    expect(screen.getByText('Book club')).toBeTruthy();
  });

  it('keeps the photo and camera buttons above the keyboard on phones, and right under the text on the web', async () => {
    const { loadAddressBook } = jest.requireMock('@/lib/addressbook');
    loadAddressBook.mockResolvedValue(book(['Family']));
    await render(<ComposeScreen />);
    await open();
    expect(within(screen.getByTestId('compose-body')).queryByLabelText('Add photos or video')).toBeNull();
    expect(screen.getByLabelText('Add photos or video')).toBeTruthy();

    const os = jest.replaceProperty(Platform, 'OS', 'web');
    try {
      await render(<ComposeScreen />);
      await open();
      expect(within(screen.getByTestId('compose-body')).getByLabelText('Add photos or video')).toBeTruthy();
    } finally {
      os.restore();
    }
  });
});
