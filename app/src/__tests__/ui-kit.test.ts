import { fontClass } from '@/components/ui/text';
import { dismissDialog, orderedButtons, pressDialogButton, showAlert } from '@/lib/dialog';

describe('Inter font classes', () => {
  it('swaps font-weight classes for the matching bundled family', () => {
    expect(fontClass('text-base font-bold text-ink')).toBe('font-sans-bold text-base text-ink');
    expect(fontClass('font-semibold')).toBe('font-sans-semibold');
    expect(fontClass('font-black')).toBe('font-sans-extrabold');
  });

  it('defaults to the regular family', () => {
    expect(fontClass(undefined)).toBe('font-sans');
    expect(fontClass('text-muted  dark:text-muted-dark')).toBe('font-sans text-muted dark:text-muted-dark');
  });
});

describe('in-app dialogs', () => {
  it('puts Cancel last, as on X', () => {
    const order = orderedButtons([{ text: 'Cancel', style: 'cancel' }, { text: 'Block', style: 'destructive' }, { text: 'Mute' }]);
    expect(order.map((b) => b.text)).toEqual(['Block', 'Mute', 'Cancel']);
  });

  it('runs the pressed button after closing, so it can open another dialog', () => {
    const block = jest.fn(() => showAlert('Blocked'));
    showAlert('Block them?', 'They aren’t told.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Block', style: 'destructive', onPress: block }]);
    pressDialogButton({ text: 'Block', style: 'destructive', onPress: block });
    expect(block).toHaveBeenCalledTimes(1);
  });

  it('back button acts like Cancel, or like the only button', () => {
    const cancel = jest.fn();
    showAlert('Delete?', undefined, [{ text: 'Cancel', style: 'cancel', onPress: cancel }, { text: 'Delete', style: 'destructive' }]);
    dismissDialog();
    expect(cancel).toHaveBeenCalledTimes(1);
    const ok = jest.fn();
    showAlert('Saved', undefined, [{ text: 'OK', onPress: ok }]);
    dismissDialog();
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
