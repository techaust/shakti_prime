import { newId } from '@shakti/contracts';
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { parseSigningKeys, type SigningKeys } from '../realtime/keys';
import { newSigningKeyJson } from '../realtime/test-keys';
import { mintRealtimeToken } from '../realtime/token';
import { signVoiceGrant, verifyVoiceToken, VOICE_TOKEN_SECONDS } from './token';

const ISSUER = 'https://bos.shakti.test';
const NOW = new Date('2026-11-17T06:00:00.000Z');

async function keys(): Promise<SigningKeys> {
  const parsed = await parseSigningKeys({ BOS_JWT_CURRENT_KEY: await newSigningKeyJson('k1') });
  if (parsed === undefined) throw new Error('no keys');
  return parsed;
}

const grant = () => ({
  jti: newId(),
  sub: newId(),
  sid: newId(),
  bos_role: 'executive' as const,
  entity_ids: [1, 3],
});

describe('the voice token', () => {
  it('names the person and the session, for the voice audience, for at most 5 minutes', async () => {
    const k = await keys();
    const g = grant();
    const minted = await signVoiceGrant(g, new Date(NOW.getTime() + 3_600_000), k, {
      issuer: ISSUER,
      now: NOW,
    });
    expect(minted.claims).toMatchObject({
      iss: ISSUER,
      aud: 'shakti-voice',
      sub: g.sub,
      sid: g.sid,
      bos_role: 'executive',
      entity_ids: [1, 3],
      jti: g.jti,
    });
    expect(minted.claims.exp - minted.claims.iat).toBe(VOICE_TOKEN_SECONDS);
    expect(await verifyVoiceToken(minted.token, k, ISSUER, NOW)).toEqual(minted.claims);
  });

  it('never lives past the session, and is refused once the session is over', async () => {
    const k = await keys();
    const end = new Date(NOW.getTime() + 90_000);
    const minted = await signVoiceGrant(grant(), end, k, { issuer: ISSUER, now: NOW });
    expect(minted.expiresAt).toEqual(end);
    await expect(
      signVoiceGrant(grant(), NOW, k, { issuer: ISSUER, now: NOW }),
    ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'voice_session_ended' } });
  });

  it('is refused when expired, from another issuer or key, or for another audience', async () => {
    const k = await keys();
    const minted = await signVoiceGrant(grant(), new Date(NOW.getTime() + 3_600_000), k, {
      issuer: ISSUER,
      now: NOW,
    });
    const later = new Date(NOW.getTime() + (VOICE_TOKEN_SECONDS + 1) * 1000);
    expect(await verifyVoiceToken(minted.token, k, ISSUER, later)).toBeUndefined();
    expect(await verifyVoiceToken(minted.token, k, 'https://other.test', NOW)).toBeUndefined();
    expect(await verifyVoiceToken(minted.token, await keys(), ISSUER, NOW)).toBeUndefined();
    // A Realtime token of the same person, signed by the same key, is not a voice token.
    const realtime = await mintRealtimeToken(
      { id: newId(), kind: 'user', roleKey: 'executive', entityIds: [1], permissions: [] },
      k,
      { issuer: ISSUER, now: NOW },
    );
    expect(await verifyVoiceToken(realtime.token, k, ISSUER, NOW)).toBeUndefined();
    // A voice token that lives longer than 5 minutes is refused by the claims' own check.
    const iat = Math.floor(NOW.getTime() / 1000);
    const long = await new SignJWT({ ...grant(), aud: 'shakti-voice' })
      .setProtectedHeader({ alg: 'ES256', kid: k.current.kid })
      .setIssuer(ISSUER)
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(k.current.privateKey);
    expect(await verifyVoiceToken(long, k, ISSUER, NOW)).toBeUndefined();
  });
});
