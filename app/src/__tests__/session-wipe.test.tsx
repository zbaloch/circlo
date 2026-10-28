// When the server ends the session (401 on refresh), the device must be wiped exactly as on sign-out: nothing of
// the previous account (keys, chats, decrypted media, queued posts, caches) may be left for the next one.
const mockCalls: string[] = [];
const mockAccount = { userId: 'u1', deviceId: 'd1', refreshToken: 'old' };

jest.mock('@/lib/keystore', () => ({
  loadAccount: async () => mockAccount,
  clearAccount: async () => void mockCalls.push('account'),
  updateRefreshToken: async () => {},
}));
jest.mock('@/lib/addressbook', () => ({ resetAddressBookCache: () => mockCalls.push('addressBook') }));
jest.mock('@/lib/feed-store', () => ({ clearFeed: () => mockCalls.push('feed') }));
jest.mock('@/lib/media', () => ({ clearMediaCache: () => mockCalls.push('media') }));
jest.mock('@/lib/messaging', () => ({ clearMessaging: async () => void mockCalls.push('messaging') }));
jest.mock('@/lib/push', () => ({ resetPush: () => mockCalls.push('push') }));
jest.mock('@/lib/outbox', () => ({ clearOutbox: () => mockCalls.push('outbox') }));
jest.mock('@/lib/use-connections', () => ({ forgetConnections: async (id: string) => void mockCalls.push(`connections:${id}`) }));
jest.mock('@/api/client', () => {
  class ApiError extends Error {
    status: number;
    constructor(mockStatus: number, mockCode: string) {
      super(mockCode);
      this.status = mockStatus;
    }
  }
  return {
    ApiError,
    api: { POST: async () => ({ response: { status: 401, ok: false } }), DELETE: async () => ({}) },
    ok: () => {
      throw new ApiError(401, 'unauthorized');
    },
    setAccessToken: (t: string | null) => t === null && mockCalls.push('accessToken'),
    setRefresher: () => {},
  };
});

// eslint-disable-next-line import/first
import { render, screen, waitFor } from '@testing-library/react-native';
// eslint-disable-next-line import/first
import { Text } from 'react-native';
// eslint-disable-next-line import/first
import { SessionProvider, useSession } from '@/lib/session';

function Status() {
  return <Text>{useSession().status}</Text>;
}

const EVERYTHING = ['account', 'accessToken', 'addressBook', 'outbox', 'feed', 'push', 'connections:u1', 'messaging', 'media'];

describe('session ended by the server', () => {
  beforeEach(() => {
    mockCalls.length = 0;
  });

  it('wipes everything the account left on the device, like sign-out', async () => {
    await render(
      <SessionProvider>
        <Status />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByText('signedOut')).toBeTruthy());
    expect([...mockCalls].sort()).toEqual([...EVERYTHING].sort());
  });
});
