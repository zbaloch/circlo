import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AppFrame, FRAME_CLASS } from '@/components/app-frame';

describe('app frame', () => {
  it('renders the app inside it', async () => {
    await render(
      <AppFrame>
        <Text>inside</Text>
      </AppFrame>,
    );
    expect(screen.getByText('inside')).toBeTruthy();
  });

  it('limits the width only on the web, so the phone apps stay full width', () => {
    const widthClasses = FRAME_CLASS.split(' ').filter((c) => /max-w|border-x|w-full|overflow/.test(c));
    expect(widthClasses.length).toBeGreaterThan(0);
    for (const c of widthClasses) expect(c.startsWith('web:')).toBe(true);
    expect(FRAME_CLASS).toContain('web:max-w-[600px]');
    // The closed drawer waits just past the column's left edge: clip it, as the phone's screen edge does.
    expect(FRAME_CLASS).toContain('web:overflow-hidden');
  });
});
