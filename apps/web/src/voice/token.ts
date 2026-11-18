import {
  DomainError,
  TOKEN_AUDIENCES,
  TOKEN_LIFETIMES,
  VoiceTokenClaims,
  type VoiceTokenGrant,
} from '@shakti/contracts';
import { createLocalJWKSet, jwtVerify, SignJWT } from 'jose';
import { BOS_JWT_ALGORITHM, JwksResponse } from '../realtime/claims';
import { publicKeyList, type SigningKeys } from '../realtime/keys';

/**
 * The voice worker's BOS token (docs/07-security.md §3.4, ADR 0003, ADR 0010): an ES256 JWT for
 * the speaking person (`sub`) and their session (`sid`), audience `shakti-voice`, signed with the
 * deployment's current key and living at most 5 minutes, never past the session's longest length.
 * Only `/api/v1` routes that take the voice token accept it; every other surface refuses its
 * audience.
 */

export const VOICE_AUDIENCE = TOKEN_AUDIENCES.voice;
export const VOICE_TOKEN_SECONDS = TOKEN_LIFETIMES.voice;

export interface MintedVoiceToken {
  token: string;
  claims: VoiceTokenClaims;
  expiresAt: Date;
}

/**
 * Signs the claims `voice.session.start` or `voice.session.token` settled. The lifetime is 5
 * minutes, cut short at the session's `notAfter`; a session already past it gets no token.
 */
export async function signVoiceGrant(
  grant: Omit<VoiceTokenGrant, 'notAfter'>,
  notAfter: Date,
  keys: SigningKeys,
  options: { issuer: string; now?: Date },
): Promise<MintedVoiceToken> {
  const now = options.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  const exp = Math.min(iat + VOICE_TOKEN_SECONDS, Math.floor(notAfter.getTime() / 1000));
  if (exp <= iat) {
    throw new DomainError('forbidden', 'the voice session has ended', {
      reason: 'voice_session_ended',
    });
  }
  const claims = VoiceTokenClaims.parse({
    iss: options.issuer,
    sub: grant.sub,
    aud: VOICE_AUDIENCE,
    sid: grant.sid,
    bos_role: grant.bos_role,
    entity_ids: [...grant.entity_ids],
    iat,
    exp,
    jti: grant.jti,
  });
  // The token always has its id; the claims' type leaves it optional for tokens of other kinds.
  const token = await new SignJWT({ ...claims, jti: grant.jti })
    .setProtectedHeader({ alg: BOS_JWT_ALGORITHM, kid: keys.current.kid, typ: 'JWT' })
    .sign(keys.current.privateKey);
  return { token, claims, expiresAt: new Date(exp * 1000) };
}

/**
 * Checks a voice token as the routes that take it do: signed by the current or the next key of
 * this deployment, this issuer, the voice audience, not expired, and the claims' shape and
 * lifetime. Undefined for anything else, never a reason: a bad token is simply not a caller.
 */
export async function verifyVoiceToken(
  token: string,
  keys: SigningKeys,
  issuer: string,
  now: Date = new Date(),
): Promise<VoiceTokenClaims | undefined> {
  try {
    const jwks = createLocalJWKSet(JwksResponse.parse({ keys: publicKeyList(keys) }));
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: VOICE_AUDIENCE,
      algorithms: [BOS_JWT_ALGORITHM],
      currentDate: now,
    });
    const claims = VoiceTokenClaims.safeParse(payload);
    return claims.success ? claims.data : undefined;
  } catch {
    return undefined;
  }
}
