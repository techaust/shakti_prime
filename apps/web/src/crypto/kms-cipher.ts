import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from '@aws-sdk/client-kms';
import {
  contextFields,
  envelopeCipher,
  FieldCipherError,
  localKeyProvider,
  type CipherContext,
  type DataKeyProvider,
  type FieldCipher,
} from '@shakti/domain';
import { hostedRuntime } from '../auth/deps';
import { AWS_DEFAULT_REGION } from '../aws-region';

export interface KmsConfig {
  /** The environment's key (id, ARN or alias): `FILES_KMS_KEY_ID`. */
  keyId: string;
  region: string;
  client?: KMSClient;
}

/** The encryption context KMS binds to each data key: the value's table, column, company and row. */
function kmsContext(context: CipherContext): Record<string, string> {
  return contextFields(context);
}

/**
 * Data keys from KMS (docs/SECURITY.md §5): `GenerateDataKey` makes a fresh AES-256 key per value
 * and `Decrypt` opens its wrapped copy, each under the value's table, column, company and row as the encryption
 * context, so KMS itself refuses a key asked for with another context. The master key never
 * leaves KMS.
 */
export function kmsKeyProvider(config: KmsConfig): DataKeyProvider {
  const client = config.client ?? new KMSClient({ region: config.region });
  return {
    async generate(context) {
      const out = await client.send(
        new GenerateDataKeyCommand({
          KeyId: config.keyId,
          KeySpec: 'AES_256',
          EncryptionContext: kmsContext(context),
        }),
      );
      if (out.Plaintext === undefined || out.CiphertextBlob === undefined || !out.KeyId) {
        throw new FieldCipherError('the key service gave no data key');
      }
      return { keyId: out.KeyId, key: out.Plaintext, wrapped: out.CiphertextBlob };
    },
    async unwrap(keyId, wrapped, context) {
      let plaintext: Uint8Array | undefined;
      try {
        const out = await client.send(
          new DecryptCommand({
            KeyId: keyId,
            CiphertextBlob: wrapped,
            EncryptionContext: kmsContext(context),
          }),
        );
        plaintext = out.Plaintext;
      } catch {
        throw new FieldCipherError('the key service would not open the data key');
      }
      if (plaintext === undefined) throw new FieldCipherError('no data key came back');
      return plaintext;
    },
  };
}

let cipher: FieldCipher | undefined;

/**
 * The field cipher of this runtime: KMS when `FILES_KMS_KEY_ID` is set; on a developer's machine
 * and in CI, the local master key `FIELD_ENCRYPTION_KEY`, which a hosted runtime never uses (and
 * does not start with it set, `productionConfigProblems()`). Undefined when neither exists, so a
 * feature that seals values answers unavailable.
 */
export function fieldCipher(env: NodeJS.ProcessEnv = process.env): FieldCipher | undefined {
  if (cipher !== undefined) return cipher;
  const keyId = env.FILES_KMS_KEY_ID ?? '';
  if (keyId !== '') {
    const region = (env.AWS_REGION ?? '') === '' ? AWS_DEFAULT_REGION : String(env.AWS_REGION);
    cipher = envelopeCipher(kmsKeyProvider({ keyId, region }));
    return cipher;
  }
  const local = env.FIELD_ENCRYPTION_KEY ?? '';
  if (local === '' || hostedRuntime(env)) return undefined;
  cipher = envelopeCipher(localKeyProvider(local));
  return cipher;
}

/** For tests: forget the chosen cipher. */
export function resetFieldCipher(): void {
  cipher = undefined;
}
