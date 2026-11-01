import { checkNow, permissionFrom, shouldOffer, summary } from '@/lib/background-check';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  AndroidImportance: { DEFAULT: 3 },
}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn(), isTaskRegisteredAsync: jest.fn(async () => true) }));
jest.mock('expo-background-task', () => ({ BackgroundTaskResult: { Success: 1, Failed: 2 }, unregisterTaskAsync: jest.fn(async () => undefined) }));
jest.mock('@/api/client', () => ({ api: {}, ok: jest.fn(), API_URL: 'https://api.example' }));

const counts = (p: Partial<Record<'requests' | 'replies' | 'likes' | 'messages' | 'signIns', number>>) => ({
  requests: 0,
  replies: 0,
  likes: 0,
  messages: 0,
  signIns: 0,
  ...p,
});

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('summary', () => {
  it('says how many of each, never who or what', () => {
    expect(summary(counts({}))).toBeNull();
    expect(summary(counts({ replies: 2, likes: 1 }), true)).toBe('2 replies, 1 like.');
    // Likes hidden (LIKES_ENABLED off): never mentioned.
    expect(summary(counts({ replies: 2, likes: 1 }), false)).toBe('2 replies.');
    expect(summary(counts({ likes: 3 }), false)).toBeNull();
    expect(summary(counts({ messages: 1, requests: 3 }))).toBe('1 new message, 3 friend requests.');
  });

  it('leads with a new sign-in', () => {
    expect(summary(counts({ signIns: 1 }))).toBe('New sign-in to your account.');
    expect(summary(counts({ signIns: 1, replies: 1 }))).toBe('New sign-in to your account. Also 1 reply.');
  });
});

describe('checkNow', () => {
  const fetchMock = jest.fn();
  beforeAll(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it('does nothing until background checks are turned on', async () => {
    await checkNow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks only with the check token (no session), notifies locally, and moves the time on', async () => {
    const Notifications = jest.requireMock('expo-notifications');
    mockStore.set('circlo.check-token', 'tok').set('circlo.check-since', '2026-10-30T10:00:00.000Z');
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => counts({ replies: 1 }) });
    await checkNow();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example/v1/activity/pending?since=2026-10-30T10%3A00%3A00.000Z');
    expect(init.headers).toEqual({ 'X-Circlo-Check-Token': 'tok' });
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ content: { title: 'Circlo', body: '1 reply.' } }));
    expect(Date.parse(mockStore.get('circlo.check-since')!)).toBeGreaterThan(Date.parse('2026-10-30T10:00:00.000Z'));
  });

  it('stays quiet when nothing is new', async () => {
    const Notifications = jest.requireMock('expo-notifications');
    mockStore.set('circlo.check-token', 'tok');
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => counts({}) });
    await checkNow();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('stops for good when the server no longer knows the token (device revoked or turned off)', async () => {
    const BackgroundTask = jest.requireMock('expo-background-task');
    mockStore.set('circlo.check-token', 'tok');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await checkNow();
    expect(mockStore.has('circlo.check-token')).toBe(false);
    expect(BackgroundTask.unregisterTaskAsync).toHaveBeenCalledWith('circlo.activity-check');
  });
});

describe('permission and offer', () => {
  it('maps the platform answer', () => {
    expect(permissionFrom({ granted: true, canAskAgain: true })).toBe('on');
    expect(permissionFrom({ granted: false, canAskAgain: true })).toBe('ask');
    expect(permissionFrom({ granted: false, canAskAgain: false })).toBe('blocked');
  });

  it('offers Circlo’s own screen once, only while the system popup can still be shown', () => {
    expect(shouldOffer('ask', false)).toBe(true);
    expect(shouldOffer('ask', true)).toBe(false);
    expect(shouldOffer('on', false)).toBe(false);
    expect(shouldOffer('blocked', false)).toBe(false);
  });
});
