import { render } from '@testing-library/react-native';

import { Icon } from '@/components/ui/icon';

const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs');

describe('the new-message button', () => {
  it('shows an envelope with a plus (Lucide MailPlus), so it reads as "write a new message"', async () => {
    expect(readFileSync('src/app/(drawer)/(tabs)/messages.tsx', 'utf8')).toMatch(/accessibilityLabel="New message" icon="mail-add-outline"/);
    const view = await render(<Icon name="mail-add-outline" accessibilityLabel="New message" />);
    expect(view.toJSON()).toMatchObject({ props: { accessibilityLabel: 'New message', accessibilityRole: 'image' } });
  });
});
