import { CLOSE_FRIENDS, NEW_FRIEND_CIRCLE, type Contact } from '@/lib/addressbook';
import {
  audienceSize,
  isValidFriendCircle,
  labelOf,
  levelOf,
  listedCircles,
  membersOf,
  migratedCircle,
  nextCustomCircle,
} from '@/lib/circles';

const friend = (circle: number, closeFriend = false): Contact => ({
  ed25519: 'e',
  x25519: 'x',
  identityVersion: 1,
  verified: false,
  circle,
  closeFriend,
  keys: [],
});

describe('circles', () => {
  // Defaults at 20/40/60/80/100; "Book club" is a circle I added between Friends and Everyone.
  const book = {
    labels: { '40': 'The kids', '90': 'Book club' },
    contacts: { a: friend(20), b: friend(80, true), c: friend(80), d: friend(90, true), e: friend(100) },
  };

  it('uses the default labels unless renamed; Only me is level 0', () => {
    expect(labelOf(book, 1)).toBe('Only me');
    expect(labelOf(book, 20)).toBe('My person');
    expect(labelOf(book, 40)).toBe('The kids');
    expect(labelOf(book, 60)).toBe('Parents & siblings');
    expect(labelOf(book, 80)).toBe('Friends');
    expect(labelOf(book, 100)).toBe('Everyone');
    expect(labelOf(book, 90)).toBe('Book club');
    expect(labelOf(book, CLOSE_FRIENDS)).toBe('Close Friends');
    expect(labelOf(book, 55)).toBe('Circle 55');
  });

  it('shows levels in order: Only me 0, then 1, 2, 3… with added circles slotted in', () => {
    expect(listedCircles(book)).toEqual([1, 20, 40, 60, 80, 90, 100]);
    expect([1, 20, 40, 60, 80, 90, 100].map((n) => levelOf(book, n))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const plain = { contacts: {} };
    expect(listedCircles(plain)).toEqual([1, 20, 40, 60, 80, 100]);
    expect(levelOf(plain, 100)).toBe(5);
  });

  it('a post to a circle reaches it and every closer one; Close Friends reaches only its members', () => {
    expect(audienceSize(book, 1)).toBe(0);
    expect(audienceSize(book, 20)).toBe(1);
    expect(audienceSize(book, 80)).toBe(3);
    expect(audienceSize(book, 100)).toBe(5);
    expect(membersOf(book, 80).sort()).toEqual(['b', 'c']);
    expect(membersOf(book, CLOSE_FRIENDS).sort()).toEqual(['b', 'd']);
    // Close Friends is not "closer than" anything: "My person" (a) isn't in it.
    expect(audienceSize(book, CLOSE_FRIENDS)).toBe(2);
  });

  it('adds new circles between Friends and Everyone', () => {
    expect(nextCustomCircle(book)).toBe(81);
    expect(nextCustomCircle({ contacts: {} })).toBe(81);
  });

  it('friends can be placed in positions 2–100 only (not Only me, not Close Friends)', () => {
    expect(isValidFriendCircle(1)).toBe(false);
    expect(isValidFriendCircle(CLOSE_FRIENDS)).toBe(false);
    expect(isValidFriendCircle(2)).toBe(true);
    expect(isValidFriendCircle(100)).toBe(true);
    expect(isValidFriendCircle(101)).toBe(false);
    expect(isValidFriendCircle(7.5)).toBe(false);
    expect(NEW_FRIEND_CIRCLE).toBe(80);
  });

  it('moves the old 1–10 layout to the new positions', () => {
    // Me only, Spouse, Kids, Kids, Parents & siblings, Extended family, Closest friends, Neighbourhood, Work, Faded, custom
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 37].map(migratedCircle)).toEqual([1, 20, 40, 40, 60, 60, 80, 80, 80, 100, 100]);
  });
});
