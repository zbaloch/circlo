import { deviceLabel } from '@/lib/view-logic';

jest.mock('@/api/client', () => ({}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

describe('device kinds', () => {
  it('labels each sign-in by its kind of app', () => {
    expect(deviceLabel({ kind: 'ios', current: true })).toBe('This device · iPhone app');
    expect(deviceLabel({ kind: 'android', current: false })).toBe('Android app');
    expect(deviceLabel({ kind: 'web', current: false })).toBe('Web browser');
    // Signed in before the kind was recorded.
    expect(deviceLabel({ kind: null, current: false })).toBe('Other device');
    expect(deviceLabel({ kind: null, current: true })).toBe('This device');
  });
});
