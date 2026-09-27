import { TOKEN_AUDIENCES, TOKEN_LIFETIMES, type RealtimeClaims } from '@shakti/contracts';

/**
 * The Realtime token's shapes. The claims, the token answer and the empty call body are the
 * published contracts (`packages/contracts/src/api/realtime.ts`); the key list and the discovery
 * document are read only by Supabase and the spike, so their checks stay here. apps/web has no
 * direct zod dependency, so those two are written out.
 */
export { RealtimeClaims, RealtimeTokenRequest, RealtimeTokenResponse } from '@shakti/contracts';

/** `TOKEN_AUDIENCES.realtime`. Mobile tokens use `shakti-mobile`, voice tokens `shakti-voice`. */
export const REALTIME_AUDIENCE = TOKEN_AUDIENCES.realtime;
/** `TOKEN_LIFETIMES.realtimeMax`: a Realtime token never lives longer than 15 minutes. */
export const REALTIME_TOKEN_MAX_SECONDS = TOKEN_LIFETIMES.realtimeMax;
/** The one algorithm of every token the BOS signs (ADR 0003). */
export const BOS_JWT_ALGORITHM = 'ES256';

export class ClaimsError extends Error {
  constructor(field: string) {
    super(`realtime document field ${field} is not valid`);
    this.name = 'ClaimsError';
  }
}

type Json = Readonly<Record<string, unknown>>;

function object(value: unknown, what: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ClaimsError(what);
  }
  return value as Json;
}

function onlyKeys(value: Json, allowed: readonly string[], what: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new ClaimsError(`${what}.${key}`);
  }
}

function url(value: unknown, field: string): string {
  if (typeof value !== 'string' || !URL.canParse(value)) throw new ClaimsError(field);
  return value;
}

/** The channels the Realtime policies let a holder of these claims join. */
export function realtimeChannels(claims: Pick<RealtimeClaims, 'sub' | 'entity_ids'>): string[] {
  return [
    `user:${claims.sub}`,
    ...claims.entity_ids.flatMap((e) => [`entity:${String(e)}:queue`, `entity:${String(e)}:board`]),
  ];
}

/** One public signing key as the key list publishes it: P-256, never a private part. */
export interface PublicSigningJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  kid: string;
  alg: typeof BOS_JWT_ALGORITHM;
  use: 'sig';
}

/** `GET /.well-known/jwks.json`: the current key and, during a rotation, the next one. */
export interface JwksResponse {
  keys: PublicSigningJwk[];
}

export const JwksResponse = {
  parse(value: unknown): JwksResponse {
    const body = object(value, 'jwks');
    onlyKeys(body, ['keys'], 'jwks');
    const keys = Array.isArray(body.keys) ? body.keys : [];
    if (keys.length === 0 || keys.length > 2) throw new ClaimsError('keys');
    return {
      keys: keys.map((raw, i) => {
        const key = object(raw, `keys[${String(i)}]`);
        onlyKeys(key, ['kty', 'crv', 'x', 'y', 'kid', 'alg', 'use'], `keys[${String(i)}]`);
        const text = (name: string) => {
          const v = key[name];
          if (typeof v !== 'string' || v === '')
            throw new ClaimsError(`keys[${String(i)}].${name}`);
          return v;
        };
        if (key.kty !== 'EC' || key.crv !== 'P-256' || key.alg !== BOS_JWT_ALGORITHM) {
          throw new ClaimsError(`keys[${String(i)}]`);
        }
        if (key.use !== 'sig') throw new ClaimsError(`keys[${String(i)}].use`);
        return {
          kty: 'EC',
          crv: 'P-256',
          x: text('x'),
          y: text('y'),
          kid: text('kid'),
          alg: BOS_JWT_ALGORITHM,
          use: 'sig',
        };
      }),
    };
  },
};

/** `GET /.well-known/openid-configuration`: what a relying party needs to find the key list. */
export interface OpenIdConfiguration {
  issuer: string;
  jwks_uri: string;
  id_token_signing_alg_values_supported: (typeof BOS_JWT_ALGORITHM)[];
  response_types_supported: string[];
  subject_types_supported: string[];
  claims_supported: string[];
}

export const OpenIdConfiguration = {
  parse(value: unknown): OpenIdConfiguration {
    const body = object(value, 'configuration');
    const list = (name: string) => {
      const v = body[name];
      if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) throw new ClaimsError(name);
      return v;
    };
    const algorithms = list('id_token_signing_alg_values_supported');
    if (algorithms.length === 0 || algorithms.some((a) => a !== BOS_JWT_ALGORITHM)) {
      throw new ClaimsError('id_token_signing_alg_values_supported');
    }
    return {
      issuer: url(body.issuer, 'issuer'),
      jwks_uri: url(body.jwks_uri, 'jwks_uri'),
      id_token_signing_alg_values_supported: [BOS_JWT_ALGORITHM],
      response_types_supported: list('response_types_supported'),
      subject_types_supported: list('subject_types_supported'),
      claims_supported: list('claims_supported'),
    };
  },
};
