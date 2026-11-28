import type { Contact } from '@/lib/people';
import { cancelPeopleReminders, schedulePeopleReminders, setPeopleRemindersOn } from '@/lib/people-reminders';

let mockScheduled: { identifier: string }[] = [];
let mockGranted = true;
const mockSchedule = jest.fn(async (req: { identifier: string }) => {
  mockScheduled.push({ identifier: req.identifier });
  return req.identifier;
});
const mockCancel = jest.fn(async (id: string) => {
  mockScheduled = mockScheduled.filter((n) => n.identifier !== id);
});
jest.mock('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: async () => mockScheduled,
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
  scheduleNotificationAsync: (req: { identifier: string }) => mockSchedule(req),
  getPermissionsAsync: async () => ({ granted: mockGranted }),
  setNotificationChannelAsync: jest.fn(async () => null),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
const mockStore = new Map<string, string>();
jest.mock('@/lib/storage', () => ({
  getItem: async (k: string) => mockStore.get(k) ?? null,
  setItem: async (k: string, v: string) => void mockStore.set(k, v),
}));

const mum: Contact = {
  contactId: 'mum',
  name: 'Mum',
  person: null,
  dates: [{ label: 'Birthday', month: 3, day: 14, year: null }],
  keepInTouchDays: null,
  keepSince: null,
  lastCaughtUp: null,
  noteCount: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockScheduled = [{ identifier: 'other-circlo-notification' }];
  mockGranted = true;
  mockStore.clear();
});

describe('People reminders on the phone', () => {
  it('replace Circlo’s earlier People reminders and leave others alone', async () => {
    await schedulePeopleReminders([mum]);
    await schedulePeopleReminders([mum]);
    expect(mockScheduled.map((n) => n.identifier)).toEqual(['other-circlo-notification', 'kit:mum:date:0']);
    expect(mockSchedule).toHaveBeenLastCalledWith(
      expect.objectContaining({
        identifier: 'kit:mum:date:0',
        content: { title: 'Mum’s birthday', body: 'Today', data: { type: 'people', contactId: 'mum' } },
        trigger: expect.objectContaining({ type: 'date' }),
      }),
    );
  });

  it('follow the phone’s permission, never asking for it', async () => {
    mockGranted = false;
    await schedulePeopleReminders([mum]);
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it('can be turned off for this phone, and go at sign-out', async () => {
    await schedulePeopleReminders([mum]);
    await setPeopleRemindersOn(false, [mum]);
    expect(mockScheduled.map((n) => n.identifier)).toEqual(['other-circlo-notification']);
    await setPeopleRemindersOn(true, [mum]);
    await cancelPeopleReminders();
    expect(mockScheduled.map((n) => n.identifier)).toEqual(['other-circlo-notification']);
  });
});
