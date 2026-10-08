import { calculateJwkThumbprint, importJWK, type CryptoKey } from 'jose';
import { BOS_JWT_ALGORITHM, type PublicSigningJwk } from './claims';

/**
 * Where the BOS signing keys come from: private P-256 keys as JWK JSON strings, one per variable.
 * `pnpm --filter web realtime-keys` prints a new one. The current key signs; the next key is only
 * published, so relying parties already hold it when a rotation promotes it (ADR 0003,
 * docs/runbooks/deploy.md).
 */
/** Environment variables as the process has them; a plain object in tests. */
export type Env = Readonly<Record<string, string | undefined>>;

export const SIGNING_KEY_ENV = {
  current: 'BOS_JWT_CURRENT_KEY',
  next: 'BOS_JWT_NEXT_KEY',
} as const;

export interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: PublicSigningJwk;
}

export interface SigningKeys {
  current: SigningKey;
  /** Published beside the current key; absent between rotations. */
  next: SigningKey | undefined;
}

/**
 * A key that cannot be used. The message names the variable and the problem, never the value:
 * the value is a private key.
 */
export class SigningKeyError extends Error {
  constructor(variable: string, problem: string) {
    super(`${variable} ${problem}`);
    this.name = 'SigningKeyError';
  }
}

interface EcPrivateJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  d: string;
  kid?: string;
}

function field(value: Record<string, unknown>, name: string): string | undefined {
  const found = value[name];
  return typeof found === 'string' && found !== '' ? found : undefined;
}

function parseJwk(raw: string, variable: string): EcPrivateJwk {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new SigningKeyError(variable, 'is not JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SigningKeyError(variable, 'is not a JSON object');
  }
  const record = value as Record<string, unknown>;
  if (record.kty !== 'EC' || record.crv !== 'P-256') {
    throw new SigningKeyError(variable, 'is not a P-256 key (kty EC, crv P-256)');
  }
  const x = field(record, 'x');
  const y = field(record, 'y');
  const d = field(record, 'd');
  if (x === undefined || y === undefined) throw new SigningKeyError(variable, 'lacks x or y');
  if (d === undefined)
    throw new SigningKeyError(variable, 'is a public key; the private key is needed');
  const kid = field(record, 'kid');
  return { kty: 'EC', crv: 'P-256', x, y, d, ...(kid === undefined ? {} : { kid }) };
}

async function signingKey(raw: string, variable: string): Promise<SigningKey> {
  const jwk = parseJwk(raw, variable);
  const publicPart = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
  // Without a kid the RFC 7638 thumbprint names the key, so the same key always has the same kid.
  const kid = jwk.kid ?? (await calculateJwkThumbprint(publicPart));
  let privateKey: CryptoKey | Uint8Array;
  try {
    privateKey = await importJWK({ ...publicPart, d: jwk.d }, BOS_JWT_ALGORITHM);
  } catch {
    throw new SigningKeyError(variable, 'is not a valid P-256 private key');
  }
  if (privateKey instanceof Uint8Array) {
    throw new SigningKeyError(variable, 'is not an asymmetric key');
  }
  return {
    kid,
    privateKey,
    publicJwk: { ...publicPart, kid, alg: BOS_JWT_ALGORITHM, use: 'sig' },
  };
}

function valueOf(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Parses the signing keys. Undefined when no current key is set (Realtime is not switched on for
 * this environment); throws `SigningKeyError` when a key is set but unusable.
 */
export async function parseSigningKeys(env: Env = process.env): Promise<SigningKeys | undefined> {
  const currentRaw = valueOf(env, SIGNING_KEY_ENV.current);
  const nextRaw = valueOf(env, SIGNING_KEY_ENV.next);
  if (currentRaw === undefined) {
    if (nextRaw !== undefined) {
      throw new SigningKeyError(SIGNING_KEY_ENV.current, 'is empty while a next key is set');
    }
    return undefined;
  }
  const current = await signingKey(currentRaw, SIGNING_KEY_ENV.current);
  const next = nextRaw === undefined ? undefined : await signingKey(nextRaw, SIGNING_KEY_ENV.next);
  if (next?.kid === current.kid) {
    throw new SigningKeyError(SIGNING_KEY_ENV.next, 'has the same kid as the current key');
  }
  return { current, next };
}

let cached: { source: string; keys: Promise<SigningKeys | undefined> } | undefined;

/**
 * The signing keys of this deployment, parsed once per set of values. Read on first use, never at
 * import, so `next build` runs without them (CLAUDE.md).
 */
export function signingKeys(env: Env = process.env): Promise<SigningKeys | undefined> {
  const source = `${env[SIGNING_KEY_ENV.current] ?? ''}\n${env[SIGNING_KEY_ENV.next] ?? ''}`;
  if (cached?.source !== source) {
    const keys = parseSigningKeys(env);
    // A failed parse is not kept: the next call tries again and reports the problem again.
    keys.catch(() => {
      if (cached?.keys === keys) cached = undefined;
    });
    cached = { source, keys };
  }
  return cached.keys;
}

/** The public key list: the current key first, then the next key during a rotation. */
export function publicKeyList(keys: SigningKeys): PublicSigningJwk[] {
  return keys.next === undefined
    ? [keys.current.publicJwk]
    : [keys.current.publicJwk, keys.next.publicJwk];
}
