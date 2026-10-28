import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Fab } from '@/components/fab';
import { CircloMark } from '@/components/circlo-mark';
import { IconButton } from '@/components/icon-button';

describe('components', () => {
  it('EmptyState shows title, body and a call to action', async () => {
    const onAction = jest.fn();
    await render(<EmptyState title="Nothing here" body="Invite someone" actionLabel="Invite" onAction={onAction} />);
    expect(screen.getByText('Nothing here')).toBeTruthy();
    expect(screen.getByText('Invite someone')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Invite' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('IconButton exposes its accessibility label', async () => {
    const onPress = jest.fn();
    await render(
      <IconButton accessibilityLabel="Open menu" onPress={onPress}>
        <Text>icon</Text>
      </IconButton>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Open menu' }));
    expect(onPress).toHaveBeenCalled();
  });

  it('Fab is labelled for screen readers', async () => {
    await render(<Fab accessibilityLabel="Compose post" />);
    expect(screen.getByRole('button', { name: 'Compose post' })).toBeTruthy();
  });

  it('CircloMark is announced as the Circlo logo', async () => {
    await render(<CircloMark wordmark />);
    expect(screen.getByLabelText('Circlo')).toBeTruthy();
  });
});
