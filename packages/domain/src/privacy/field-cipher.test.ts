import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  envelopeCipher,
  FieldCipherError,
  localKeyProvider,
  type FieldEnvelope,
} from './field-cipher';

const KEY = randomBytes(32).toString('base64');
const BANK = { table: 'entities', column: 'bank_json', entityId: 1, rowId: '1' };
const cipher = envelopeCipher(localKeyProvider(KEY));

function flip(b64: string): string {
  const bytes = Buffer.from(b64, 'base64');
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return bytes.toString('base64');
}

describe('field cipher (AES-256-GCM, a data key per value)', () => {
  it('opens what it sealed', async () => {
    const sealed = await cipher.encrypt('{"account":"50100012345678"}', BANK);
    expect(sealed.keyId).toBe('local');
    expect(JSON.stringify(sealed)).not.toContain('50100012345678');
    expect(await cipher.decrypt(sealed, BANK)).toBe('{"account":"50100012345678"}');
  });

  it('seals the same value differently each time', async () => {
    const a = await cipher.encrypt('same', BANK);
    const b = await cipher.encrypt('same', BANK);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.wrappedKey).not.toBe(b.wrappedKey);
  });

  it('keeps an empty value', async () => {
    expect(await cipher.decrypt(await cipher.encrypt('', BANK), BANK)).toBe('');
  });

  it.each(['ciphertext', 'tag', 'iv', 'wrappedKey'] as const)(
    'refuses a value whose %s was altered',
    async (part) => {
      const sealed = await cipher.encrypt('IFSC SBIN0001234', BANK);
      const altered: FieldEnvelope = { ...sealed, [part]: flip(sealed[part]) };
      await expect(cipher.decrypt(altered, BANK)).rejects.toBeInstanceOf(FieldCipherError);
    },
  );

  it.each([
    ['another column', { column: 'upi_id' }],
    ['another table', { table: 'accounts' }],
    ['another row', { rowId: '2' }],
    ['another company', { entityId: 2 }],
  ])('refuses the value moved to %s', async (_, moved) => {
    const sealed = await cipher.encrypt('secret', BANK);
    await expect(cipher.decrypt(sealed, { ...BANK, ...moved })).rejects.toBeInstanceOf(
      FieldCipherError,
    );
  });

  it('refuses another master key and another key id', async () => {
    const sealed = await cipher.encrypt('secret', BANK);
    const other = envelopeCipher(localKeyProvider(randomBytes(32).toString('base64')));
    await expect(other.decrypt(sealed, BANK)).rejects.toBeInstanceOf(FieldCipherError);
    await expect(
      cipher.decrypt({ ...sealed, keyId: 'arn:aws:kms:x' }, BANK),
    ).rejects.toBeInstanceOf(FieldCipherError);
  });

  it('refuses something that is not an envelope', async () => {
    await expect(cipher.decrypt({ v: 2 } as unknown as FieldEnvelope, BANK)).rejects.toBeInstanceOf(
      FieldCipherError,
    );
  });

  it.each(['', 'c2hvcnQ=', randomBytes(31).toString('base64'), 'not base64 at all!'])(
    'refuses the master key %j',
    (key) => {
      expect(() => localKeyProvider(key)).toThrow(FieldCipherError);
    },
  );
});
