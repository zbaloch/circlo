/** Encoding helpers between the core (ArrayBuffer) and the API (base64 strings, UUID strings). No crypto here. */

export function toB64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function fromB64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Base64URL without padding (WebAuthn's encoding). */
export function toB64Url(data: ArrayBuffer | Uint8Array): string {
  return toB64(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Either base64 or base64url, padded or not (passkey libraries return both, depending on the platform). */
export function fromAnyB64(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return fromB64(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

export function utf8(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).slice().buffer;
}

const HEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID string → the 16 bytes used in crypto AAD (same bytes the server stores). */
export function uuidToBytes(uuid: string): ArrayBuffer {
  if (!HEX.test(uuid)) throw new Error('invalid uuid');
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out.buffer;
}

export function bytesToUuid(data: ArrayBuffer): string {
  const b = new Uint8Array(data);
  if (b.length !== 16) throw new Error('uuid must be 16 bytes');
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Version-4 layout over 16 random bytes supplied by the caller (the core's CSPRNG). */
export function uuidFromRandom(random: ArrayBuffer): string {
  const b = new Uint8Array(random.slice(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return bytesToUuid(b.buffer);
}

export function equalBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** Groups of 4 hex characters for showing fingerprints to people. */
export function hexGroups(data: ArrayBuffer): string {
  const h = Array.from(new Uint8Array(data), (x) => x.toString(16).padStart(2, '0')).join('');
  return h.match(/.{1,4}/g)?.join(' ') ?? '';
}
