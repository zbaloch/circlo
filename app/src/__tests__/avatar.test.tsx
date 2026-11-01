import { render, screen } from '@testing-library/react-native';

import { Avatar } from '@/components/avatar';

jest.mock('expo-image', () => ({ Image: () => null }));

describe('avatar initial', () => {
  it('keeps the case of the name or username', async () => {
    await render(<Avatar name="zaheer" />);
    expect(screen.getByText('z')).toBeTruthy();
    await render(<Avatar name="Zaheer" />);
    expect(screen.getByText('Z')).toBeTruthy();
  });

  it('uses the first whole character, and ? without a name', async () => {
    await render(<Avatar name="  😀 smile" />);
    expect(screen.getByText('😀')).toBeTruthy();
    await render(<Avatar />);
    expect(screen.getByText('?')).toBeTruthy();
  });
});
