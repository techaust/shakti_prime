import { describe, expect, it } from 'vitest';
import { API_FIXTURES, REALTIME_CLAIMS, VOICE_CLAIMS } from './fixtures';
import { RealtimeClaims, RealtimeTokenResponse } from './realtime';
import { VoiceSessionRequest, VoiceTokenClaims } from './voice';

function claimsOf(token: string): unknown {
  const payload = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

describe('the Realtime token (ADR 0003)', () => {
  it('carries sub, entity_ids, bos_role, aud shakti-realtime and role authenticated', () => {
    const response = RealtimeTokenResponse.parse(API_FIXTURES['realtime.token'].response);
    expect(RealtimeClaims.parse(claimsOf(response.token))).toMatchObject({
      aud: 'shakti-realtime',
      role: 'authenticated',
      bos_role: 'tele_caller_cc',
      entity_ids: [1, 3],
    });
  });

  it('never names an application role in role, which Supabase reads as a Postgres role', () => {
    expect(RealtimeClaims.safeParse({ ...REALTIME_CLAIMS, role: 'tele_caller_cc' }).success).toBe(
      false,
    );
  });

  it('lives 15 minutes at most', () => {
    const long = { ...REALTIME_CLAIMS, exp: REALTIME_CLAIMS.iat + 16 * 60 };
    expect(RealtimeClaims.safeParse(long).success).toBe(false);
    const backwards = { ...REALTIME_CLAIMS, exp: REALTIME_CLAIMS.iat - 1 };
    expect(RealtimeClaims.safeParse(backwards).success).toBe(false);
  });

  it('holds at least one entity and no agent role', () => {
    expect(RealtimeClaims.safeParse({ ...REALTIME_CLAIMS, entity_ids: [] }).success).toBe(false);
    expect(
      RealtimeClaims.safeParse({ ...REALTIME_CLAIMS, bos_role: 'agent:concierge' }).success,
    ).toBe(false);
  });

  it('lists only user and entity channels', () => {
    const response = API_FIXTURES['realtime.token'].response as Record<string, unknown>;
    expect(
      RealtimeTokenResponse.safeParse({ ...response, channels: ['entity:1:costs'] }).success,
    ).toBe(false);
  });
});

describe('the voice worker token', () => {
  it('acts as the speaking person for five minutes at most', () => {
    expect(VoiceTokenClaims.parse(VOICE_CLAIMS)).toMatchObject({ aud: 'shakti-voice' });
    const long = { ...VOICE_CLAIMS, exp: VOICE_CLAIMS.iat + 5 * 60 + 1 };
    expect(VoiceTokenClaims.safeParse(long).success).toBe(false);
  });

  it('is a different audience from the Realtime token', () => {
    expect(VoiceTokenClaims.safeParse({ ...VOICE_CLAIMS, aud: 'shakti-realtime' }).success).toBe(
      false,
    );
  });

  it('starts only with an answer to the recording question', () => {
    expect(VoiceSessionRequest.safeParse({ mode: 'teach' }).success).toBe(false);
    expect(VoiceSessionRequest.safeParse({ mode: 'dictate', consentRecording: true }).success).toBe(
      false,
    );
  });
});
