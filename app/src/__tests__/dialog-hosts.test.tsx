import { act, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { DialogHost } from '@/components/ui/dialog-host';
import { dismissDialog, showAlert } from '@/lib/dialog';

/**
 * A dialog opened from a bottom sheet shows inside the sheet (its inline host), never as a second Modal stacked with
 * the sheet's, which could leave an invisible layer that swallows every tap. Only the newest host draws it.
 */
describe('dialog hosts', () => {
  afterEach(() => act(() => dismissDialog()));

  it('draws the dialog once, in the newest host, and falls back to the root when the sheet goes', async () => {
    const tree = (sheet: boolean) => (
      <View>
        <DialogHost />
        {sheet ? (
          <View testID="sheet">
            <DialogHost inline />
          </View>
        ) : null}
      </View>
    );
    const r = await render(tree(true));
    await act(() => showAlert('Add Ana to Family?', 'Ana will see posts to Family.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Add' }]));
    expect(screen.getAllByText('Add Ana to Family?')).toHaveLength(1);
    expect(screen.getByTestId('sheet')).toContainElement(screen.getByText('Add Ana to Family?'));

    // The sheet closes while the dialog is up: the root host takes it over.
    await r.rerender(tree(false));
    expect(screen.getAllByText('Add Ana to Family?')).toHaveLength(1);
  });
});
