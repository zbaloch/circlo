import { MAX_CIRCLES, STARTER_CIRCLES, type Contact } from '@/lib/addressbook';
import {
  audienceLabel,
  audienceSize,
  circleDefs,
  circleName,
  circlesOf,
  membersOf,
  nextCircleId,
  validAudience,
} from '@/lib/circles';

jest.mock('@/api/client', () => ({}));

const friend = (circles: number[] = [], status: Contact['status'] = 'accepted'): Contact => ({ status, displayName: 'F', handle: 'f', circles });

describe('circles', () => {
  // Starter circles: 1 Close Friends, 2 Family, 3 Kids, 4 Work; 6 is one I added.
  const book = {
    circleDefs: [...STARTER_CIRCLES, { id: 6, name: 'Book club' }],
    contacts: { a: friend([1, 2]), b: friend([2]), c: friend([3]), d: friend(), e: friend([6, 7]), p: friend([3], 'outgoing') },
  };

  it('starts with Close Friends, Family, Kids and Work', () => {
    expect(circleDefs({} as never).map((c) => c.name)).toEqual(['Close Friends', 'Family', 'Kids', 'Work']);
    expect(circleName(book, 6)).toBe('Book club');
  });

  it('a friend can be in any number of circles; deleted circles are ignored', () => {
    expect(circlesOf(book, book.contacts.a)).toEqual([1, 2]);
    expect(circlesOf(book, book.contacts.e)).toEqual([6]); // 7 doesn't exist
    expect(membersOf(book, 2).sort()).toEqual(['a', 'b']);
    expect(membersOf(book, 4)).toEqual([]);
  });

  it('a circle reaches only its members; several circles reach each member once; Everyone reaches all friends', () => {
    expect(audienceSize(book, { kind: 'onlyMe' })).toBe(0);
    expect(audienceSize(book, { kind: 'everyone' })).toBe(5);
    expect(audienceSize(book, { kind: 'circles', ids: [3] })).toBe(1);
    // Family is not "closer than" Kids: nesting is gone.
    expect(audienceSize(book, { kind: 'circles', ids: [2] })).toBe(2);
    expect(audienceSize(book, { kind: 'circles', ids: [1, 2] })).toBe(2);
    expect(audienceSize(book, { kind: 'circles', ids: [1, 2, 3, 6] })).toBe(4);
    // Someone I've asked but who hasn't accepted yet sees nothing.
    expect(membersOf(book, 3).sort()).toEqual(['c', 'p']);
  });

  it('labels audiences for the author', () => {
    expect(audienceLabel(book, { kind: 'onlyMe' })).toBe('Only me');
    expect(audienceLabel(book, { kind: 'everyone' })).toBe('Everyone');
    expect(audienceLabel(book, { kind: 'circles', ids: [3, 2] })).toBe('Family, Kids');
    expect(audienceLabel(book, { kind: 'circles', ids: [6, 1, 2] })).toBe('Close Friends +2');
  });

  it('only accepts audiences of existing circles, at least one, no repeats', () => {
    expect(validAudience(book, { kind: 'onlyMe' })).toBe(true);
    expect(validAudience(book, { kind: 'everyone' })).toBe(true);
    expect(validAudience(book, { kind: 'circles', ids: [1, 6] })).toBe(true);
    expect(validAudience(book, { kind: 'circles', ids: [] })).toBe(false);
    expect(validAudience(book, { kind: 'circles', ids: [5] })).toBe(false);
    expect(validAudience(book, { kind: 'circles', ids: [2, 2] })).toBe(false);
  });

  it('new circles take the lowest free id, up to 8', () => {
    expect(nextCircleId(book)).toBe(5);
    const full = { circleDefs: Array.from({ length: MAX_CIRCLES }, (_, i) => ({ id: i + 1, name: `c${i}` })) };
    expect(nextCircleId(full)).toBeNull();
  });

});
