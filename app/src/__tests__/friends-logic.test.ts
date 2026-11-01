import { bookFrom } from '@/lib/addressbook';
import { inviteProblem, justJoined, parseInviteLink, type Connection } from '@/lib/friends';

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

describe('using an invite', () => {
  it('explains why it can’t be used', () => {
    expect(inviteProblem(404)).toMatch(/doesn’t work/);
    expect(inviteProblem(400)).toMatch(/your own/);
    expect(inviteProblem(409)).toMatch(/already connected/);
    expect(inviteProblem(429)).toMatch(/tomorrow/);
    expect(inviteProblem(500)).toBeNull();
  });

  it('spots who joined since my link was on screen, newest first', () => {
    const c = (userId: string, status: Connection['status']) => ({ userId, status, profile: { displayName: userId, bio: '', handle: userId } });
    const known = new Set(['old']);
    const now = [c('old', 'accepted'), c('new1', 'accepted'), c('asked', 'outgoing'), c('new2', 'accepted'), c('req', 'incoming')];
    expect(justJoined(now, known).map((x) => x.userId)).toEqual(['new2', 'new1']);
    expect(justJoined(now, null)).toEqual([]);
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
