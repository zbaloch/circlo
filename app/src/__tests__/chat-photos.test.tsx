import { fireEvent, render, screen } from '@testing-library/react-native';

import { ChatTitle } from '@/components/chat-title';
import type { Conversation } from '@/lib/messaging';
import { NewMessageScreen } from '@/app/new-message';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (p: unknown) => mockPush(p), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
  Redirect: () => null,
}));
jest.mock('@/api/client', () => ({}));
const account = { userId: 'me', handle: 'me' };
jest.mock('@/lib/session', () => ({ useSession: () => ({ status: 'signedIn', account }) }));
const mockBook = {
  circleDefs: [],
  contacts: {
    a: { status: 'accepted', displayName: 'Ana', handle: 'ana', avatarUrl: 'https://media.test/ana.jpg?sig=1', circles: [] },
    b: { status: 'accepted', displayName: 'Bo', handle: 'bo', avatarUrl: null, circles: [] },
  },
};
jest.mock('@/lib/addressbook', () => ({
  ...jest.requireActual('@/lib/addressbook'),
  loadAddressBook: async () => mockBook,
}));

// A photo shows as its address, so the tests can see which one is on screen.
jest.mock('expo-image', () => {
  const { Text } = jest.requireActual('react-native');
  return { Image: ({ source }: { source: { uri: string } }) => <Text testID="photo">{source.uri}</Text> };
});
const photoUris = () => screen.queryAllByTestId('photo').map((n) => n.props.children);

const chat = (members: string[], name?: string): Conversation =>
  ({
    groupId: 'g1',
    name,
    members,
    people: {
      a: { name: 'Ana', handle: 'ana', avatarUrl: 'https://media.test/ana.jpg?sig=1' },
      b: { name: 'Bo', handle: 'bo', avatarUrl: null },
    },
    messages: [],
    readSeq: 0,
    active: true,
    updatedAtMs: 0,
  }) as unknown as Conversation;

describe('photos in chat', () => {
  beforeEach(() => jest.clearAllMocks());

  it('New message shows each person’s photo, or their initial without one', async () => {
    await render(<NewMessageScreen />);
    expect(await screen.findByText('Ana')).toBeTruthy();
    expect(photoUris()).toEqual(['https://media.test/ana.jpg?sig=1']);
    expect(screen.getByText('B')).toBeTruthy();
  });

  it('a chat with one person: their photo and name on top, tapping opens their profile', async () => {
    await render(<ChatTitle conv={chat(['a'])} account={account} onGroup={jest.fn()} />);
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(photoUris()).toEqual(['https://media.test/ana.jpg?sig=1']);
    await fireEvent.press(screen.getByRole('button', { name: 'Ana’s profile' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/friend/[id]', params: { id: 'a' } });
  });

  it('a group chat: tapping the title shows the people in it', async () => {
    const onGroup = jest.fn();
    await render(<ChatTitle conv={chat(['a', 'b'], 'Book club')} account={account} onGroup={onGroup} />);
    expect(screen.getByText('Book club')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'People in Book club' }));
    expect(onGroup).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
