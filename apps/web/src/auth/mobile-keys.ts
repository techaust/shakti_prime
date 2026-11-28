import { importJWK, type CryptoKey } from 'jose';
import { createHash } from 'node:crypto';
import { BOS_JWT_ALGORITHM } from '../realtime/claims';
import { signingKey, SigningKeyError, type Env } from '../realtime/keys';

/**
 * The field app's own ES256 key pair (docs/03-roadmap-appendix/phase4.md §6.4): the private key
 * signs its 15-minute access tokens and the public key checks them. Both are P-256 keys as one-line
 * JWK JSON, made by `pnpm --filter web exec tsx scripts/mobile-keys.ts`. The pair is the field
 * app's alone: a mobile token is never published in the key list nor accepted anywhere else, and
 * the Realtime key pair can rotate without signing every phone out.
 */
export const MOBILE_KEY_ENV = {
  private: 'MOBILE_JWT_PRIVATE_KEY',
  public: 'MOBILE_JWT_PUBLIC_KEY',
} as const;

export interface MobileKeys {
  kid: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  /**
   * The secret a rotation derives the next refresh token from (`nextRefreshToken`), taken from the
   * private key, so a retry whose answer was lost gets the same token again without the server
   * keeping it. It changes with the pair.
   */
  refreshKey: Buffer;
}

function valueOf(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/**
 * What is wrong with the pair, without reading it as a key: both or neither set, each a P-256 JWK,
 * the private one holding `d`, the public one not, and the same point in both. For
 * `productionConfigProblems()`, which runs before anything else; the messages name the variables,
 * never a value.
 */
export function mobileKeyProblems(env: Env): string[] {
  const privateRaw = valueOf(env, MOBILE_KEY_ENV.private);
  const publicRaw = valueOf(env, MOBILE_KEY_ENV.public);
  if (privateRaw === undefined && publicRaw === undefined) return [];
  if (privateRaw === undefined || publicRaw === undefined) {
    return [
      `${MOBILE_KEY_ENV.private} and ${MOBILE_KEY_ENV.public} are set together or not at all`,
    ];
  }
  const read = (raw: string): Record<string, unknown> | undefined => {
    try {
      const value: unknown = JSON.parse(raw);
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  };
  const priv = read(privateRaw);
  const pub = read(publicRaw);
  const problems: string[] = [];
  const p256 = (jwk: Record<string, unknown> | undefined) =>
    jwk?.kty === 'EC' &&
    jwk.crv === 'P-256' &&
    typeof jwk.x === 'string' &&
    typeof jwk.y === 'string';
  if (!p256(priv) || typeof priv?.d !== 'string') {
    problems.push(`${MOBILE_KEY_ENV.private} must be a private P-256 key as JWK JSON`);
  }
  if (!p256(pub) || pub?.d !== undefined) {
    problems.push(`${MOBILE_KEY_ENV.public} must be a public P-256 key as JWK JSON, without d`);
  }
  if (problems.length === 0 && (priv?.x !== pub?.x || priv?.y !== pub?.y)) {
    problems.push(`${MOBILE_KEY_ENV.public} is not the public half of ${MOBILE_KEY_ENV.private}`);
  }
  return problems;
}

/**
 * Parses the pair. Undefined when neither is set (the field app is not switched on here, and its
 * routes answer `integration_unavailable`); throws `SigningKeyError` when the pair is unusable.
 */
export async function parseMobileKeys(env: Env = process.env): Promise<MobileKeys | undefined> {
  const problems = mobileKeyProblems(env);
  if (problems.length > 0) {
    throw new SigningKeyError(MOBILE_KEY_ENV.private, `pair: ${problems.join('; ')}`);
  }
  const privateRaw = valueOf(env, MOBILE_KEY_ENV.private);
  const publicRaw = valueOf(env, MOBILE_KEY_ENV.public);
  if (privateRaw === undefined || publicRaw === undefined) return undefined;
  const signing = await signingKey(privateRaw, MOBILE_KEY_ENV.private);
  // mobileKeyProblems has checked the shape: an EC P-256 key with x and y.
  const { x, y } = JSON.parse(publicRaw) as { x: string; y: string };
  let publicKey: CryptoKey | Uint8Array;
  try {
    publicKey = await importJWK({ kty: 'EC', crv: 'P-256', x, y }, BOS_JWT_ALGORITHM);
  } catch {
    throw new SigningKeyError(MOBILE_KEY_ENV.public, 'is not a valid P-256 public key');
  }
  if (publicKey instanceof Uint8Array) {
    throw new SigningKeyError(MOBILE_KEY_ENV.public, 'is not an asymmetric key');
  }
  const { d } = JSON.parse(privateRaw) as { d: string };
  const refreshKey = createHash('sha256').update('shakti-field-refresh\n').update(d).digest();
  return { kid: signing.kid, privateKey: signing.privateKey, publicKey, refreshKey };
}

let cached: { source: string; keys: Promise<MobileKeys | undefined> } | undefined;

/** The pair of this deployment, parsed once per set of values, on first use, never at import. */
export function mobileKeys(env: Env = process.env): Promise<MobileKeys | undefined> {
  const source = `${env[MOBILE_KEY_ENV.private] ?? ''}\n${env[MOBILE_KEY_ENV.public] ?? ''}`;
  if (cached?.source !== source) {
    const keys = parseMobileKeys(env);
    keys.catch(() => {
      if (cached?.keys === keys) cached = undefined;
    });
    cached = { source, keys };
  }
  return cached.keys;
}
