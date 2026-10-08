import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Field encryption (docs/07-security.md §5, bank details): each value is sealed with AES-256-GCM
 * under its own data key, and the data key is kept only wrapped by a master key (KMS in a hosted
 * environment, `FIELD_ENCRYPTION_KEY` on a developer's machine and in CI). The context names the
 * table, column, company and row the value belongs to; it is bound into both seals, so a value
 * copied into another column, another row or another company's row does not open there.
 */
export interface CipherContext {
  table: string;
  column: string;
  entityId: number;
  /** The row's id, or its key when the row has no id of its own. */
  rowId: string;
}

const B64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/);

/** What a sealed value is stored as (a `jsonb` column): ciphertext and its wrapped data key. */
export const FieldEnvelopeSchema = z
  .object({
    v: z.literal(1),
    /** The master key that wrapped the data key: a KMS key id or `local`. */
    keyId: z.string().min(1).max(200),
    wrappedKey: B64,
    iv: B64,
    tag: B64,
    ciphertext: B64,
  })
  .strict();
export type FieldEnvelope = z.infer<typeof FieldEnvelopeSchema>;

export interface FieldCipher {
  encrypt(plaintext: string, context: CipherContext): Promise<FieldEnvelope>;
  /** The plaintext; throws when the envelope was altered or the context is not its own. */
  decrypt(envelope: FieldEnvelope, context: CipherContext): Promise<string>;
}

/** A master key that makes and opens data keys (KMS `GenerateDataKey` and `Decrypt`). */
export interface DataKeyProvider {
  generate(
    context: CipherContext,
  ): Promise<{ keyId: string; key: Uint8Array; wrapped: Uint8Array }>;
  unwrap(keyId: string, wrapped: Uint8Array, context: CipherContext): Promise<Uint8Array>;
}

export class FieldCipherError extends Error {}

const IV_BYTES = 12;
const KEY_BYTES = 32;

/** The additional data both seals carry: the table, column, company and row, in one fixed form. */
export function contextBytes(context: CipherContext): Buffer {
  return Buffer.from(JSON.stringify(contextFields(context)), 'utf8');
}

/** The context as strings in a fixed order: the additional data and the KMS encryption context. */
export function contextFields(context: CipherContext): Record<string, string> {
  return {
    table: context.table,
    column: context.column,
    entityId: String(context.entityId),
    rowId: context.rowId,
  };
}

function seal(key: Uint8Array, plaintext: Uint8Array, aad: Buffer) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function open(key: Uint8Array, iv: Buffer, tag: Buffer, ciphertext: Buffer, aad: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new FieldCipherError('the sealed value does not open with this context');
  }
}

/** AES-256-GCM with a fresh data key per value, wrapped by `keys`. */
export function envelopeCipher(keys: DataKeyProvider): FieldCipher {
  return {
    async encrypt(plaintext, context) {
      const { keyId, key, wrapped } = await keys.generate(context);
      try {
        const sealed = seal(key, Buffer.from(plaintext, 'utf8'), contextBytes(context));
        return {
          v: 1,
          keyId,
          wrappedKey: Buffer.from(wrapped).toString('base64'),
          iv: sealed.iv.toString('base64'),
          tag: sealed.tag.toString('base64'),
          ciphertext: sealed.ciphertext.toString('base64'),
        };
      } finally {
        key.fill(0);
      }
    },
    async decrypt(envelope, context) {
      const parsed = FieldEnvelopeSchema.safeParse(envelope);
      if (!parsed.success) throw new FieldCipherError('not a sealed value');
      const e = parsed.data;
      const key = await keys.unwrap(e.keyId, Buffer.from(e.wrappedKey, 'base64'), context);
      try {
        return open(
          key,
          Buffer.from(e.iv, 'base64'),
          Buffer.from(e.tag, 'base64'),
          Buffer.from(e.ciphertext, 'base64'),
          contextBytes(context),
        ).toString('utf8');
      } finally {
        key.fill(0);
      }
    },
  };
}

/**
 * The master key of a developer's machine and CI: 32 bytes, base64 (`FIELD_ENCRYPTION_KEY`). A
 * hosted runtime refuses it (`productionConfigProblems()`); it uses KMS.
 */
export function localKeyProvider(masterKeyBase64: string): DataKeyProvider {
  const master = Buffer.from(masterKeyBase64, 'base64');
  if (master.length !== KEY_BYTES || !B64.safeParse(masterKeyBase64).success) {
    throw new FieldCipherError('FIELD_ENCRYPTION_KEY must be 32 bytes in base64');
  }
  return {
    generate(context) {
      const key = randomBytes(KEY_BYTES);
      const sealed = seal(master, key, contextBytes(context));
      const wrapped = Buffer.concat([sealed.iv, sealed.tag, sealed.ciphertext]);
      return Promise.resolve({ keyId: 'local', key: new Uint8Array(key), wrapped });
    },
    unwrap(keyId, wrapped, context) {
      if (keyId !== 'local') throw new FieldCipherError('sealed under another master key');
      const bytes = Buffer.from(wrapped);
      const iv = bytes.subarray(0, IV_BYTES);
      const tag = bytes.subarray(IV_BYTES, IV_BYTES + 16);
      const ciphertext = bytes.subarray(IV_BYTES + 16);
      return Promise.resolve(
        new Uint8Array(open(master, iv, tag, ciphertext, contextBytes(context))),
      );
    },
  };
}
