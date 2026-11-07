import { confirmMembership } from '@/lib/circles';

jest.mock('@/api/client', () => ({}));
type Btn = { text: string; style?: string; onPress?: () => void };
const mockAlert = jest.fn<void, [string, string | undefined, Btn[] | undefined]>();
jest.mock('@/lib/dialog', () => ({ showAlert: (t: string, m?: string, b?: Btn[]) => mockAlert(t, m, b) }));

const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs');

describe('changing someone’s circles always asks first', () => {
  beforeEach(() => mockAlert.mockReset());

  it('says what it means, and only acts on confirm', () => {
    const go = jest.fn();
    confirmMembership('Ana', 'Family', false, go);
    expect(mockAlert).toHaveBeenCalledWith('Remove Ana from Family?', expect.stringMatching(/no longer see/), expect.any(Array));
    expect(go).not.toHaveBeenCalled();
    const buttons = mockAlert.mock.calls[0][2]!;
    buttons.find((b) => b.text === 'Cancel')?.onPress?.();
    expect(go).not.toHaveBeenCalled();
    buttons.find((b) => b.text === 'Remove')?.onPress?.();
    expect(go).toHaveBeenCalledWith('Ana removed from Family');
  });

  it('is used on a circle’s screen and on a person’s profile', () => {
    expect(readFileSync('src/app/circle/[n].tsx', 'utf8')).toMatch(/confirmMembership\(/);
    expect(readFileSync('src/app/friend/[id].tsx', 'utf8')).toMatch(/confirmMembership\(/);
  });
});
