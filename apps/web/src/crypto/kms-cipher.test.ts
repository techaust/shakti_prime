import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import { envelopeCipher, FieldCipherError } from '@shakti/domain';
import { mockClient } from 'aws-sdk-client-mock';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fieldCipher, kmsKeyProvider, resetFieldCipher } from './kms-cipher';

const client = new KMSClient({
  region: 'ap-south-1',
  credentials: { accessKeyId: 'test-access-key', secretAccessKey: 'test secret phrase' },
});
const kms = mockClient(client);
const KEY_ARN = 'arn:aws:kms:ap-south-1:111122223333:key/files';
const BANK = { table: 'entities', column: 'bank_json', entityId: 1, rowId: '1' };
const BANK_CONTEXT = { table: 'entities', column: 'bank_json', entityId: '1', rowId: '1' };

/**
 * A stand-in for KMS: it remembers each data key it issued with the context it was issued under,
 * and opens a wrapped key only under that same context, as KMS does.
 */
function fakeKms() {
  const issued = new Map<string, { key: Uint8Array; context: string }>();
  kms.on(GenerateDataKeyCommand).callsFake((input: { EncryptionContext?: object }) => {
    const key = new Uint8Array(randomBytes(32));
    const wrapped = randomBytes(16);
    issued.set(wrapped.toString('hex'), {
      key: new Uint8Array(key),
      context: JSON.stringify(input.EncryptionContext),
    });
    return { KeyId: KEY_ARN, Plaintext: key, CiphertextBlob: new Uint8Array(wrapped) };
  });
  kms
    .on(DecryptCommand)
    .callsFake((input: { CiphertextBlob?: Uint8Array; EncryptionContext?: object }) => {
      const found = issued.get(Buffer.from(input.CiphertextBlob ?? []).toString('hex'));
      if (found?.context !== JSON.stringify(input.EncryptionContext)) {
        throw new Error('InvalidCiphertextException');
      }
      return { KeyId: KEY_ARN, Plaintext: new Uint8Array(found.key) };
    });
}

const kmsCipher = () =>
  envelopeCipher(kmsKeyProvider({ keyId: 'alias/files', region: 'ap-south-1', client }));

beforeEach(() => {
  kms.reset();
  resetFieldCipher();
});
afterEach(resetFieldCipher);

describe('the KMS field cipher', () => {
  it('seals with a fresh data key under the table and column, and opens it again', async () => {
    fakeKms();
    const cipher = kmsCipher();
    const sealed = await cipher.encrypt('HDFC0001234', BANK);
    expect(sealed.keyId).toBe(KEY_ARN);
    const [generate] = kms.commandCalls(GenerateDataKeyCommand);
    expect(generate?.args[0].input).toEqual({
      KeyId: 'alias/files',
      KeySpec: 'AES_256',
      EncryptionContext: BANK_CONTEXT,
    });
    expect(await cipher.decrypt(sealed, BANK)).toBe('HDFC0001234');
    const [decrypt] = kms.commandCalls(DecryptCommand);
    expect(decrypt?.args[0].input.EncryptionContext).toEqual(BANK_CONTEXT);
  });

  it.each([
    ['another table', { table: 'accounts' }],
    ['another row', { rowId: '2' }],
    ['another company', { entityId: 3 }],
  ])('refuses a value moved to %s, as KMS does', async (_, moved) => {
    fakeKms();
    const cipher = kmsCipher();
    const sealed = await cipher.encrypt('secret', BANK);
    await expect(cipher.decrypt(sealed, { ...BANK, ...moved })).rejects.toBeInstanceOf(
      FieldCipherError,
    );
  });

  it('refuses a tampered value even with its data key', async () => {
    fakeKms();
    const cipher = kmsCipher();
    const sealed = await cipher.encrypt('secret', BANK);
    const altered = { ...sealed, ciphertext: Buffer.from('another value').toString('base64') };
    await expect(cipher.decrypt(altered, BANK)).rejects.toBeInstanceOf(FieldCipherError);
  });

  it('says so when the key service gives no key', async () => {
    kms.on(GenerateDataKeyCommand).resolves({});
    await expect(kmsCipher().encrypt('x', BANK)).rejects.toBeInstanceOf(FieldCipherError);
  });
});

describe('choosing the field cipher', () => {
  const localKey = randomBytes(32).toString('base64');

  it('uses the local key on a developer machine', async () => {
    const cipher = fieldCipher({ NODE_ENV: 'development', FIELD_ENCRYPTION_KEY: localKey });
    expect(cipher).toBeDefined();
    const sealed = await cipher?.encrypt('x', BANK);
    expect(sealed?.keyId).toBe('local');
  });

  it('never uses the local key on a hosted runtime', () => {
    expect(fieldCipher({ NODE_ENV: 'production', FIELD_ENCRYPTION_KEY: localKey })).toBeUndefined();
  });

  it('has none without a key', () => {
    expect(fieldCipher({ NODE_ENV: 'development' })).toBeUndefined();
  });

  it('uses KMS whenever the key is named', () => {
    expect(fieldCipher({ NODE_ENV: 'production', FILES_KMS_KEY_ID: 'alias/files' })).toBeDefined();
  });
});
