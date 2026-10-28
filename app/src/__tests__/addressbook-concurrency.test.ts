// A fake server that enforces the address book's compare-and-set (version N only over N-1), and a pass-through
// "core" (no crypto under jest), so we can race two edits from the same device.
const mockServer: { version: number; ciphertext: string | null; puts: number } = { version: 0, ciphertext: null, puts: 0 };
let mockPutDelay: (() => Promise<void>) | null = null;

jest.mock('@circlo/core', () => ({
  BlobKind: { AddressBook: 0 },
  sealUserBlob: (_k: Uint8Array, _kind: number, _id: Uint8Array, plain: Uint8Array) => plain,
  openUserBlob: (_k: Uint8Array, _kind: number, _id: Uint8Array, ct: Uint8Array) => ct,
}));

jest.mock('@/api/client', () => {
  class ApiError extends Error {
    mockStatus: number;
    constructor(mockStatus: number, mockCode: string) {
      super(mockCode);
      this.mockStatus = mockStatus;
    }
  }
  const respond = (status: number, data?: unknown) => ({ data, response: { status, ok: status < 300 } });
  return {
    ApiError,
    ok: (r: { data?: unknown; response: { status: number; ok: boolean } }) => {
      if (!r.response.ok) throw new ApiError(r.response.status, 'error');
      return r.data;
    },
    api: {
      GET: async () =>
        mockServer.ciphertext === null ? respond(404) : respond(200, { ciphertext: mockServer.ciphertext, version: mockServer.version }),
      PUT: async (_path: string, opts: { body: { ciphertext: string; version: number } }) => {
        if (mockPutDelay) {
          const wait = mockPutDelay;
          mockPutDelay = null;
          await wait();
        }
        if (opts.body.version !== mockServer.version + 1) return respond(409);
        mockServer.version = opts.body.version;
        mockServer.ciphertext = opts.body.ciphertext;
        mockServer.puts++;
        return respond(200, {});
      },
    },
  };
});

// eslint-disable-next-line import/first
import { loadAddressBook, resetAddressBookCache, updateAddressBook, type AddressBook } from '@/lib/addressbook';

const account = { userId: '00000000-0000-0000-0000-000000000001', dataKey: 'AAAA' } as Parameters<typeof updateAddressBook>[0];
const contact = (circle: number) => ({ ed25519: 'e', x25519: 'x', identityVersion: 1, verified: false, circle, keys: [] });

beforeEach(async () => {
  Object.assign(mockServer, { version: 0, ciphertext: null, puts: 0 });
  resetAddressBookCache();
  await updateAddressBook(account, (b: AddressBook) => {
    b.contacts.friend = contact(2);
  });
});

describe('address book writes from one device', () => {
  it('a background sync never undoes a move made at the same time', async () => {
    // The move's save is slow; the sync starts while it's in flight, from the same (old) book.
    let release!: () => void;
    mockPutDelay = () => new Promise<void>((r) => (release = r));
    const move = updateAddressBook(account, (b) => {
      b.contacts.friend.circle = 5;
    });
    const sync = updateAddressBook(account, (b) => {
      b.contacts.friend.displayName = 'Zaheer';
    });
    await new Promise((r) => setTimeout(r, 0));
    release();
    await Promise.all([move, sync]);

    resetAddressBookCache();
    const saved = await loadAddressBook(account);
    expect(saved.contacts.friend.circle).toBe(5);
    expect(saved.contacts.friend.displayName).toBe('Zaheer');
  });

  it('re-applies a change on top of a newer book saved elsewhere instead of overwriting it', async () => {
    await loadAddressBook(account); // cached at the current version
    // Another device moves the friend outward and bumps the server version.
    const other = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(mockServer.ciphertext!), (c) => c.charCodeAt(0)))) as AddressBook;
    other.contacts.friend.circle = 9;
    mockServer.ciphertext = btoa(JSON.stringify(other));
    mockServer.version++;

    await updateAddressBook(account, (b) => {
      b.contacts.friend.displayName = 'Zaheer';
    });
    resetAddressBookCache();
    const saved = await loadAddressBook(account);
    expect(saved.contacts.friend.circle).toBe(9);
    expect(saved.contacts.friend.displayName).toBe('Zaheer');
  });
});
