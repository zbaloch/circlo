import { render, screen } from '@testing-library/react-native';

import GrowthScreen from '@/app/settings/growth';
import { change, lastTwoWeeks, shortDate, type Growth, type GrowthDay } from '@/lib/growth';

jest.setTimeout(20_000);

jest.mock('expo-router', () => ({
  useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
jest.mock('@/api/client', () => ({}));

const day = (date: string, signups = 0, posts = 0): GrowthDay => ({ date, signups, inviteJoins: 0, connections: 0, posts, replies: 0 });
// Newest first, as the server sends them: 14 days, 1 sign-up a day this week and 2 a day the week before.
const days = Array.from({ length: 30 }, (_, i) => day(`2026-11-${String(30 - i).padStart(2, '0')}`, i < 7 ? 1 : i < 14 ? 2 : 0, i === 0 ? 5 : 0));
const mockGrowth: Growth = { days, totals: { people: 1234, connections: 56, posts: 789 } };
jest.mock('@/lib/growth', () => ({ ...jest.requireActual('@/lib/growth'), fetchGrowth: async () => mockGrowth }));

describe('Growth (admins only)', () => {
  it('sums this week and the week before', () => {
    expect(lastTwoWeeks(days, 'signups')).toEqual({ thisWeek: 7, lastWeek: 14 });
    expect(lastTwoWeeks(days.slice(0, 3), 'signups')).toEqual({ thisWeek: 3, lastWeek: 0 });
    expect(change(7, 14)).toBe('−7');
    expect(change(3, 1)).toBe('+2');
    expect(change(2, 2)).toBe('same');
    expect(shortDate('2026-11-20')).toBe('20 Nov');
  });

  it('shows totals, the week, and each day, with counts only', async () => {
    await render(<GrowthScreen />);
    expect(await screen.findByText('1,234')).toBeTruthy();
    expect(screen.getByText('People')).toBeTruthy();
    expect(screen.getByText('−7 on last')).toBeTruthy();
    expect(screen.getByText('30 Nov')).toBeTruthy();
    expect(screen.getByText('1 Nov')).toBeTruthy();
    expect(screen.getByText(/Counts only, never who/)).toBeTruthy();
  });
});
