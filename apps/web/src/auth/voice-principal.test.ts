import { newId, type Principal } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { parseSigningKeys, type Env } from '../realtime/keys';
import { newSigningKeyJson } from '../realtime/test-keys';
import { signVoiceGrant } from '../voice/token';
import { voicePrincipalFromToken, type VoicePrincipalDeps } from './voice-principal';

const ISSUER = 'https://bos.shakti.test';
const NOW = new Date('2026-11-17T06:00:00.000Z');

const executive: Principal = {
  id: newId(),
  kind: 'user',
  roleKey: 'executive',
  entityIds: [1, 2, 3],
  permissions: [
    { key: 'voice.use', scope: 'all' },
    { key: 'knowledge.ask', scope: 'all' },
    { key: 'finance.cost.read', scope: 'all' },
    { key: 'procurement.rate.read', scope: 'all' },
  ],
};

async function setUp(entityIds: number[] = [1, 2]) {
  const vars: Env = {
    BETTER_AUTH_URL: ISSUER,
    BOS_JWT_CURRENT_KEY: await newSigningKeyJson('current'),
  };
  const keys = await parseSigningKeys(vars);
  if (keys === undefined) throw new Error('no keys');
  const sid = newId();
  const minted = await signVoiceGrant(
    { jti: newId(), sub: executive.id, sid, bos_role: 'executive', entity_ids: entityIds },
    new Date(NOW.getTime() + 600_000),
    keys,
    { issuer: ISSUER, now: NOW },
  );
  const deps = (over: Partial<VoicePrincipalDeps> = {}): VoicePrincipalDeps => ({
    person: (userId) => Promise.resolve(userId === executive.id ? executive : undefined),
    live: (voice) => Promise.resolve(voice.voiceSessionId === sid),
    env: vars,
    now: () => NOW,
    ...over,
  });
  return { token: minted.token, sid, deps };
}

describe('the caller a voice token speaks for', () => {
  it('is the person through the session, over its companies, without either cost permission', async () => {
    const { token, sid, deps } = await setUp();
    const resolved = await voicePrincipalFromToken(token, deps());
    expect(resolved?.principal).toEqual({
      id: executive.id,
      kind: 'voice_session',
      voiceSessionId: sid,
      roleKey: 'executive',
      entityIds: [1, 2],
      permissions: [
        { key: 'voice.use', scope: 'all' },
        { key: 'knowledge.ask', scope: 'all' },
      ],
    });
  });

  it('is nobody when the person may not act, the session is not live, or a company is no longer theirs', async () => {
    const { token, deps } = await setUp();
    expect(
      await voicePrincipalFromToken(token, deps({ person: () => Promise.resolve(undefined) })),
    ).toBeUndefined();
    expect(
      await voicePrincipalFromToken(token, deps({ live: () => Promise.resolve(false) })),
    ).toBeUndefined();
    const narrowed = { ...executive, entityIds: [1] };
    expect(
      await voicePrincipalFromToken(token, deps({ person: () => Promise.resolve(narrowed) })),
    ).toBeUndefined();
  });

  it('is nobody for a token that does not check out, and when voice is not set up', async () => {
    const { token, deps } = await setUp();
    const later = new Date(NOW.getTime() + 301_000);
    expect(await voicePrincipalFromToken(token, deps({ now: () => later }))).toBeUndefined();
    expect(await voicePrincipalFromToken(`${token}x`, deps())).toBeUndefined();
    expect(
      await voicePrincipalFromToken(token, deps({ env: { BETTER_AUTH_URL: ISSUER } })),
    ).toBeUndefined();
  });
});
