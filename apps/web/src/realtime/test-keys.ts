import { exportJWK, generateKeyPair } from 'jose';

/**
 * A fresh private signing key as the environment holds it, for tests only. Made at test time, so no
 * key ever sits in the repository.
 */
export async function newSigningKeyJson(kid?: string): Promise<string> {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(privateKey);
  return JSON.stringify(kid === undefined ? jwk : { ...jwk, kid });
}
