import { createHmac } from 'node:crypto';

/** RFC 6238 with the defaults Better Auth uses (SHA-1, 30 s, 6 digits), from a base32 secret. */
export function totpCode(secretBase32: string, at: Date = new Date()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.toUpperCase().replaceAll('=', '').replaceAll(' ', '')) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  }
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at.getTime() / 1000 / 30)));
  const digest = createHmac('sha1', bytes).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0xf;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, '0');
}
