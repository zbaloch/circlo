import type { Contact } from '@/lib/addressbook';
import { audienceSize, isValidFriendCircle, labelOf, listedCircles, membersOf, nextCustomCircle } from '@/lib/circles';

const friend = (circle: number): Contact => ({ ed25519: 'e', x25519: 'x', identityVersion: 1, verified: false, circle, keys: [] });

describe('circles', () => {
  const book = {
    labels: { '7': 'Best mates', '12': 'Book club' },
    contacts: { a: friend(2), b: friend(7), c: friend(7), d: friend(9), e: friend(100) },
  };

  it('uses PLAN.md default labels unless renamed', () => {
    expect(labelOf(book, 1)).toBe('Me only');
    expect(labelOf(book, 5)).toBe('Parents & siblings');
    expect(labelOf(book, 7)).toBe('Best mates');
    expect(labelOf(book, 12)).toBe('Book club');
    expect(labelOf(book, 55)).toBe('Circle 55');
  });

  it('a post to circle n reaches that circle and every closer one', () => {
    expect(audienceSize(book, 1)).toBe(0);
    expect(audienceSize(book, 5)).toBe(1);
    expect(audienceSize(book, 7)).toBe(3);
    expect(audienceSize(book, 9)).toBe(4);
    expect(audienceSize(book, 100)).toBe(5);
    expect(membersOf(book, 7).sort()).toEqual(['b', 'c']);
  });

  it('lists 1-10 plus named or occupied custom circles, and finds the next free one', () => {
    expect(listedCircles(book)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 100]);
    expect(nextCustomCircle(book)).toBe(11);
  });

  it('friends can be placed in circles 2-100 only', () => {
    expect(isValidFriendCircle(1)).toBe(false);
    expect(isValidFriendCircle(2)).toBe(true);
    expect(isValidFriendCircle(100)).toBe(true);
    expect(isValidFriendCircle(101)).toBe(false);
    expect(isValidFriendCircle(7.5)).toBe(false);
  });
});
