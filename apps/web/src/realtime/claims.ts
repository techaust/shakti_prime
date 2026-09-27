import {
  EntityIdSchema,
  IdSchema,
  StaffRoleKeySchema,
  type EntityId,
  type StaffRoleKey,
} from '@shakti/contracts';

/**
 * The Realtime token's shapes, kept beside the route until the published contracts land
 * (`packages/contracts/src/api/realtime.ts` and `common.ts` on the contracts branch). Field names,
 * the audience and the lifetime match those contracts exactly, and each schema here has the same
 * name and a `parse()` of the same meaning, so switching is an import change. apps/web has no
 * direct zod dependency, so the checks are written out, reusing the contract id schemas.
 */

/** `TOKEN_AUDIENCES.realtime`. Mobile tokens use `shakti-mobile`, voice tokens `shakti-voice`. */
export const REALTIME_AUDIENCE = 'shakti-realtime';
/** `TOKEN_LIFETIMES.realtimeMax`: a Realtime token never lives longer than 15 minutes. */
export const REALTIME_TOKEN_MAX_SECONDS = 15 * 60;
/** The one algorithm of every token the BOS signs (ADR 0003). */
export const BOS_JWT_ALGORITHM = 'ES256';

export class ClaimsError extends Error {
  constructor(field: string) {
    super(`realtime token field ${field} is not valid`);
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

function seconds(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ClaimsError(field);
  }
  return value;
}

function url(value: unknown, field: string): string {
  if (typeof value !== 'string' || !URL.canParse(value)) throw new ClaimsError(field);
  return value;
}

/**
 * Claims exactly as ADR 0003 fixes them. Supabase reads `role` as the Postgres role for its Data
 * API, so it is always `authenticated`, which holds nothing on application objects (AUDIT M1,
 * M15); the BOS role travels as `bos_role`.
 */
export interface RealtimeClaims {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  jti?: string;
  aud: typeof REALTIME_AUDIENCE;
  role: 'authenticated';
  bos_role: StaffRoleKey;
  entity_ids: EntityId[];
}

const CLAIM_KEYS = ['iss', 'sub', 'iat', 'exp', 'jti', 'aud', 'role', 'bos_role', 'entity_ids'];

export const RealtimeClaims = {
  parse(value: unknown): RealtimeClaims {
    const claims = object(value, 'claims');
    onlyKeys(claims, CLAIM_KEYS, 'claims');
    const sub = IdSchema.safeParse(claims.sub);
    const bosRole = StaffRoleKeySchema.safeParse(claims.bos_role);
    const entityIds = Array.isArray(claims.entity_ids)
      ? claims.entity_ids.map((e) => EntityIdSchema.safeParse(e))
      : [];
    const iat = seconds(claims.iat, 'iat');
    const exp = seconds(claims.exp, 'exp');
    if (!sub.success) throw new ClaimsError('sub');
    if (claims.aud !== REALTIME_AUDIENCE) throw new ClaimsError('aud');
    if (claims.role !== 'authenticated') throw new ClaimsError('role');
    if (!bosRole.success) throw new ClaimsError('bos_role');
    if (entityIds.length === 0 || entityIds.some((e) => !e.success)) {
      throw new ClaimsError('entity_ids');
    }
    if (exp <= iat || exp - iat > REALTIME_TOKEN_MAX_SECONDS) throw new ClaimsError('exp');
    if (claims.jti !== undefined && typeof claims.jti !== 'string') throw new ClaimsError('jti');
    return {
      iss: url(claims.iss, 'iss'),
      sub: sub.data,
      iat,
      exp,
      ...(typeof claims.jti === 'string' ? { jti: claims.jti } : {}),
      aud: REALTIME_AUDIENCE,
      role: 'authenticated',
      bos_role: bosRole.data,
      entity_ids: entityIds.flatMap((e) => (e.success ? [e.data] : [])),
    };
  },
};

/** The channels the Realtime policies let a holder of these claims join. */
export function realtimeChannels(claims: Pick<RealtimeClaims, 'sub' | 'entity_ids'>): string[] {
  return [
    `user:${claims.sub}`,
    ...claims.entity_ids.flatMap((e) => [`entity:${String(e)}:queue`, `entity:${String(e)}:board`]),
  ];
}

const CHANNEL = /^(user:[0-9a-f-]{36}|entity:\d{1,5}:(queue|board))$/;
const COMPACT_JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/;

/** `POST /api/v1/realtime/token`: the token, when it stops working and the channels it opens. */
export interface RealtimeTokenResponse {
  token: string;
  expiresAt: string;
  channels: string[];
}

export const RealtimeTokenResponse = {
  parse(value: unknown): RealtimeTokenResponse {
    const body = object(value, 'response');
    onlyKeys(body, ['token', 'expiresAt', 'channels'], 'response');
    if (typeof body.token !== 'string' || !COMPACT_JWT.test(body.token)) {
      throw new ClaimsError('token');
    }
    if (typeof body.expiresAt !== 'string' || Number.isNaN(Date.parse(body.expiresAt))) {
      throw new ClaimsError('expiresAt');
    }
    const channels = Array.isArray(body.channels) ? body.channels : [];
    if (channels.length === 0 || !channels.every((c) => typeof c === 'string' && CHANNEL.test(c))) {
      throw new ClaimsError('channels');
    }
    return { token: body.token, expiresAt: body.expiresAt, channels: channels as string[] };
  },
};

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
