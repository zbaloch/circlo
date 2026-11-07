import { fireEvent, render, screen } from '@testing-library/react-native';

import { CirclePickerSheet, circlesLine, peopleCircles } from '@/components/circle-choice';
import { PersonRow } from '@/components/person-row';
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

describe('My People: which circles each person is in (only I see this)', () => {
  it('names their circles, or says they’re only in Everyone', () => {
    expect(peopleCircles(book, [1, 2])).toBe('Family, Close Friends');
    expect(peopleCircles(book, [])).toBe('Everyone only');
  });

  it('shows it on the person’s row, with their bio', async () => {
    const open = jest.fn();
    await render(<PersonRow id="m" name="Ana" handle="ana" bio="Baker" note="Family, Close Friends" onPress={open} />);
    expect(screen.getByText('Family, Close Friends')).toBeTruthy();
    expect(screen.getByText('Baker')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Ana, @ana/ }));
    expect(open).toHaveBeenCalled();
  });
});
