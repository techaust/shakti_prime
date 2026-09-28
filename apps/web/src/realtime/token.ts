import { DomainError, isAgentRole, newId, type Principal } from '@shakti/contracts';
import { createLocalJWKSet, jwtVerify, SignJWT } from 'jose';
import {
  BOS_JWT_ALGORITHM,
  OpenIdConfiguration,
  REALTIME_AUDIENCE,
  REALTIME_TOKEN_MAX_SECONDS,
  RealtimeClaims,
  type JwksResponse,
} from './claims';
import type { Env, SigningKeys } from './keys';

export const JWKS_PATH = '/.well-known/jwks.json';
export const OPENID_CONFIGURATION_PATH = '/.well-known/openid-configuration';

/**
 * The issuer of every BOS token: the origin of the deployment (`BETTER_AUTH_URL`), which is where
 * Supabase looks for `/.well-known/openid-configuration`. Undefined when it is not set or not a URL.
 */
export function bosIssuer(env: Env = process.env): string | undefined {
  const url = env.BETTER_AUTH_URL ?? '';
  if (url === '') return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** The discovery document for the issuer: enough for a relying party to find the key list. */
export function openIdConfiguration(issuer: string): OpenIdConfiguration {
  return OpenIdConfiguration.parse({
    issuer,
    jwks_uri: new URL(JWKS_PATH, issuer).toString(),
    id_token_signing_alg_values_supported: [BOS_JWT_ALGORITHM],
    response_types_supported: ['id_token'],
    subject_types_supported: ['public'],
    claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'jti', 'role', 'bos_role', 'entity_ids'],
  });
}

export interface MintOptions {
  issuer: string;
  now?: Date;
  /** Clamped to `REALTIME_TOKEN_MAX_SECONDS`. */
  ttlSeconds?: number;
}

export interface MintedToken {
  token: string;
  claims: RealtimeClaims;
  expiresAt: Date;
}

/**
 * Signs a Realtime token for a signed-in user with the current key (ADR 0003). The claims name the
 * user, the entities in the principal's scope and the BOS role; `role` is `authenticated`, which
 * holds nothing on application objects, so the token opens Realtime channels and nothing else.
 * The route does not call this: it signs the grant `realtime.token.issue` settled and audited
 * (`signRealtimeGrant`). The spike script and the token tests mint directly.
 */
export async function mintRealtimeToken(
  principal: Principal,
  keys: SigningKeys,
  options: MintOptions,
): Promise<MintedToken> {
  if (principal.kind !== 'user' || isAgentRole(principal.roleKey)) {
    throw new DomainError('forbidden', 'only a signed-in person receives a Realtime token');
  }
  if (principal.entityIds.length === 0) {
    throw new DomainError('forbidden', 'a Realtime token needs at least one entity in scope');
  }
  return signRealtimeGrant(
    {
      jti: newId(),
      sub: principal.id,
      bos_role: principal.roleKey,
      entity_ids: [...new Set(principal.entityIds)].sort((a, b) => a - b),
    },
    keys,
    options,
  );
}

/**
 * Signs the claims `realtime.token.issue` settled (and audited) with the current key: the grant
 * names the person, their role, their entities and the token's id; the issuer, the times, the
 * audience and `role: authenticated` are added here (ADR 0003).
 */
export async function signRealtimeGrant(
  grant: { jti: string; sub: string; bos_role: string; entity_ids: readonly number[] },
  keys: SigningKeys,
  options: MintOptions,
): Promise<MintedToken> {
  const now = options.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  const ttl = Math.min(
    options.ttlSeconds ?? REALTIME_TOKEN_MAX_SECONDS,
    REALTIME_TOKEN_MAX_SECONDS,
  );
  if (ttl <= 0) throw new DomainError('internal', 'a Realtime token needs a positive lifetime');
  const { jti } = grant;
  const claims = RealtimeClaims.parse({
    iss: options.issuer,
    sub: grant.sub,
    aud: REALTIME_AUDIENCE,
    role: 'authenticated',
    bos_role: grant.bos_role,
    entity_ids: [...grant.entity_ids],
    iat,
    exp: iat + ttl,
    jti,
  });
  const token = await new SignJWT({ ...claims, jti })
    .setProtectedHeader({ alg: BOS_JWT_ALGORITHM, kid: keys.current.kid, typ: 'JWT' })
    .sign(keys.current.privateKey);
  return { token, claims, expiresAt: new Date(claims.exp * 1000) };
}

/**
 * Verifies a Realtime token against a published key list, as Supabase does: the signature by a
 * listed key, the issuer, the audience, the expiry and the claim shape. For tests and the spike.
 */
export async function verifyRealtimeToken(
  token: string,
  jwks: JwksResponse,
  issuer: string,
  now: Date = new Date(),
): Promise<RealtimeClaims> {
  const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
    issuer,
    audience: REALTIME_AUDIENCE,
    algorithms: [BOS_JWT_ALGORITHM],
    currentDate: now,
  });
  return RealtimeClaims.parse(payload);
}
