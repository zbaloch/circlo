import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { HeaderBar } from '@/components/ui/header';

jest.mock('expo-router', () => ({ router: {}, useNavigation: () => ({}) }));
jest.mock('@/lib/session', () => ({ useSession: () => ({ status: 'signedOut' }) }));
jest.mock('@/lib/me', () => ({ useMe: () => null }));

describe('the header bar', () => {
  it('shows a screen’s own title (a chat’s photo and name) when it has one', async () => {
    await render(<HeaderBar title="Chat" titleNode={<Text>Imran Gul with photo</Text>} left={null} />);
    expect(screen.getByText('Imran Gul with photo')).toBeTruthy();
    expect(screen.queryByText('Chat')).toBeNull();
  });

  it('otherwise its plain title', async () => {
    await render(<HeaderBar title="Settings" left={null} />);
    expect(screen.getByRole('header')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
  });
});
