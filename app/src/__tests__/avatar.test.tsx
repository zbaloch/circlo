import { render, screen } from '@testing-library/react-native';

import { Avatar, AVATAR_COLORS, avatarColor } from '@/components/avatar';

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

describe('avatar colour', () => {
  const ids = Array.from({ length: 60 }, (_, i) => `0b6c${i.toString(16).padStart(4, '0')}-1a2b-4c3d-8e9f-${(i * 7919).toString(16).padStart(12, '0')}`);

  it('is the same for the same person every time', () => {
    for (const id of ids) expect(avatarColor(id)).toBe(avatarColor(id));
  });

  it('spreads people across the palette', () => {
    expect(new Set(ids.map(avatarColor)).size).toBeGreaterThanOrEqual(8);
  });

  it('has a light and a dark variant for every colour, and keeps the brand colour without an id', () => {
    expect(AVATAR_COLORS.length).toBe(10);
    for (const c of AVATAR_COLORS) {
      expect(c.bg).toMatch(/^bg-avatar-\d+ dark:bg-avatar-\d+-dark$/);
      expect(c.text).toMatch(/^text-avatar-\d+-ink dark:text-avatar-\d+-ink-dark$/);
    }
    expect(avatarColor(undefined).bg).toContain('bg-primary-soft');
  });
});
