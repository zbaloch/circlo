import { fireEvent, render, screen } from '@testing-library/react-native';

import { CirclePickerSheet, circlesLine } from '@/components/circle-choice';
import { STARTER_CIRCLES } from '@/lib/addressbook';

jest.mock('@/api/client', () => ({}));

const book = { circleDefs: STARTER_CIRCLES, contacts: {} };

describe('adding someone: Everyone always, more circles if I like', () => {
  it('says a friend is in Everyone, plus any circles I picked', () => {
    expect(circlesLine(book, [])).toBe('Everyone');
    expect(circlesLine(book, [1])).toBe('Everyone, Family');
  });

  it('shows Everyone first, ticked and locked, then the circles to add them to', async () => {
    const done = jest.fn();
    await render(<CirclePickerSheet visible book={book} selected={[]} onDone={done} onClose={() => {}} confirmLabel="Connect" />);
    const everyone = screen.getByRole('checkbox', { name: /Everyone/ });
    expect(everyone.props.accessibilityState).toEqual({ checked: true, disabled: true });
    expect(screen.getByText(/Everyone you connect with is added to Everyone/)).toBeTruthy();

    await fireEvent.press(screen.getByRole('checkbox', { name: /Family/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Connect' }));
    expect(done).toHaveBeenCalledWith([1]);
  });
});
