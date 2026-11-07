import { fireEvent, render, screen } from '@testing-library/react-native';

import { CirclePickerSheet, circlesLine } from '@/components/circle-choice';
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
  it('always includes Everyone (everyone you’re connected with is in it), then their circles', () => {
    expect(circlesLine(book, [1, 2])).toBe('Everyone, Family, Close Friends');
    expect(circlesLine(book, [])).toBe('Everyone');
  });

  it('shows it in grey, like the audience under a post: it’s information, not a link', async () => {
    await render(<PersonRow id="m" name="Ana" handle="ana" note="Everyone, Family" onPress={() => {}} />);
    expect(screen.getByText('Everyone, Family').props.className).toMatch(/text-muted/);
    expect(screen.getByText('Everyone, Family').props.className).not.toMatch(/text-primary/);
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
