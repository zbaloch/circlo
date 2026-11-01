import { bookFrom } from '@/lib/addressbook';
import { parseInviteLink } from '@/lib/friends';

jest.mock('@/api/client', () => ({}));

describe('invite links', () => {
  const token = 'test-only-not-a-secret-invite';

  it('reads the token from website, web app and app links', () => {
    expect(parseInviteLink(`https://www.hellocirclo.com/i/${token}`)).toBe(token);
    expect(parseInviteLink(`  https://www.hellocirclo.com/i/${token}/\n`)).toBe(token);
    expect(parseInviteLink(`https://app.hellocirclo.com/i/${token}`)).toBe(token);
    expect(parseInviteLink(`circlo://i/${token}`)).toBe(token);
  });

  it('rejects other hosts, plain http and bad tokens', () => {
    expect(parseInviteLink(`https://evil.example/i/${token}`)).toBeNull();
    expect(parseInviteLink(`http://www.hellocirclo.com/i/${token}`)).toBeNull();
    expect(parseInviteLink('https://www.hellocirclo.com/i/short')).toBeNull();
    expect(parseInviteLink(`https://www.hellocirclo.com/i/${token}?x=1`)).toBeNull();
    expect(parseInviteLink('not a link')).toBeNull();
  });
});

describe('address book', () => {
  it('is built from the server’s friends and circles', () => {
    const book = bookFrom(
      [
        { userId: 'u1', status: 'accepted', name: 'Ana', username: 'ana', avatarUrl: null, circles: [1, 2] },
        { userId: 'u2', status: 'incoming', name: 'Ben', username: 'ben', circles: [] },
      ],
      [
        { id: 1, name: 'Close Friends' },
        { id: 2, name: 'Family' },
      ],
    );
    expect(book.contacts.u1).toEqual({ status: 'accepted', displayName: 'Ana', handle: 'ana', avatarUrl: null, circles: [1, 2] });
    expect(book.contacts.u2.status).toBe('incoming');
    expect(book.circleDefs.map((c) => c.name)).toEqual(['Close Friends', 'Family']);
  });
});
