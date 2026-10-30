import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { relativeTime } from '@/lib/time';
import { useNow } from '@/lib/use-now';

function Stamp({ ms }: { ms: number }) {
  const now = useNow();
  return <Text>{relativeTime(ms, now)}</Text>;
}

describe('useNow', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('moves relative timestamps on as time passes, instead of freezing at first render', async () => {
    const createdAt = Date.now() - 40_000;
    await render(<Stamp ms={createdAt} />);
    expect(screen.getByText('40s')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(screen.getByText('1m')).toBeTruthy();
  });
});
