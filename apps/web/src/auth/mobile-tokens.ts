import {
  MobileAccessClaims,
  newId,
  TOKEN_AUDIENCES,
  TOKEN_LIFETIMES,
  type StaffRoleKey,
} from '@shakti/contracts';
import { jwtVerify, SignJWT } from 'jose';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { BOS_JWT_ALGORITHM } from '../realtime/claims';
import type { MobileKeys } from './mobile-keys';

/**
 * The field app's tokens (docs/06-api.md §2, docs/03-roadmap-appendix/backend-weeks-3-5.md §2.4):
 * a 15-minute ES256 access token naming the person (`sub`), the installation (`sid`), their BOS
 * role and companies at issue, checked statelessly and then against the phone's row; and an opaque
 * refresh token of 256 random bits, of which the server keeps only the SHA-256.
 */

export const MOBILE_AUDIENCE = TOKEN_AUDIENCES.mobile;
export const MOBILE_ACCESS_SECONDS = TOKEN_LIFETIMES.mobileAccess;
export const MOBILE_REFRESH_SECONDS = TOKEN_LIFETIMES.mobileRefresh;

export interface MobileGrant {
  userId: string;
  deviceId: string;
  roleKey: StaffRoleKey;
  entityIds: readonly number[];
}

export interface SignedAccessToken {
  token: string;
  expiresAt: Date;
}

/** Signs an access token for a phone that has just signed in or refreshed. */
export async function signMobileAccessToken(
  grant: MobileGrant,
  keys: MobileKeys,
  options: { issuer: string; now: Date },
): Promise<SignedAccessToken> {
  const iat = Math.floor(options.now.getTime() / 1000);
  const jti = newId();
  const claims = MobileAccessClaims.parse({
    iss: options.issuer,
    sub: grant.userId,
    aud: MOBILE_AUDIENCE,
    sid: grant.deviceId,
    bos_role: grant.roleKey,
    entity_ids: [...new Set(grant.entityIds)].sort((a, b) => a - b),
    iat,
    exp: iat + MOBILE_ACCESS_SECONDS,
    jti,
  });
  const token = await new SignJWT({ ...claims, jti })
    .setProtectedHeader({ alg: BOS_JWT_ALGORITHM, kid: keys.kid, typ: 'JWT' })
    .sign(keys.privateKey);
  return { token, expiresAt: new Date(claims.exp * 1000) };
}

/**
 * The claims of a valid access token of this deployment: its signature by the field app's public
 * key, the issuer, the audience, the expiry and the claim shape. Undefined for anything else; why
 * is never told, and the token is never logged.
 */
export async function verifyMobileAccessToken(
  token: string,
  keys: MobileKeys,
  issuer: string,
  now: Date,
): Promise<MobileAccessClaims | undefined> {
  try {
    const { payload } = await jwtVerify(token, keys.publicKey, {
      issuer,
      audience: MOBILE_AUDIENCE,
      algorithms: [BOS_JWT_ALGORITHM],
      currentDate: now,
    });
    const claims = MobileAccessClaims.safeParse(payload);
    return claims.success ? claims.data : undefined;
  } catch {
    return undefined;
  }
}

/** A new refresh token: 256 random bits in base64url, 43 characters (`RefreshTokenSchema`). */
export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * The refresh token a rotation hands out for `previous`: an HMAC of it under the pair's refresh
 * key, as unguessable as a random one to anyone without the key, and the same for the same
 * previous token. So a retry of a refresh whose answer was lost (the phone on a weak network)
 * gets the very token the rotation stored the hash of, with no token kept by the server.
 */
export function nextRefreshToken(previous: string, keys: Pick<MobileKeys, 'refreshKey'>): string {
  return createHmac('sha256', keys.refreshKey).update(`refresh\n${previous}`).digest('base64url');
}

/** What the server keeps of a refresh token: its SHA-256 in hex. */
export function refreshTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The bearer token of an `Authorization` header, or undefined. */
export function bearerToken(headers: Headers): string | undefined {
  const value = headers.get('authorization');
  const match = value === null ? null : /^Bearer ([A-Za-z0-9._-]{16,4096})$/.exec(value.trim());
  return match?.[1];
}
