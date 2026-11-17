import {
  DomainError,
  ErrorEnvelope,
  newId,
  VOICE_AGENT_NAME,
  VoiceDispatchMetadata,
  VoiceSessionResponse,
  VoiceTokenResponse,
  type Principal,
  type VoiceSessionGrant,
} from '@shakti/contracts';
import { memoryKeyValue } from '@shakti/domain';
import { decodeJwt } from 'jose';
import { describe, expect, it } from 'vitest';
import type { AgentRoomOptions, LiveKitRooms } from '../integrations/voice/livekit';
import { parseSigningKeys, type Env, type SigningKeys } from '../realtime/keys';
import { newSigningKeyJson } from '../realtime/test-keys';
import {
  refreshVoiceTokenRoute,
  startVoiceSessionRoute,
  VOICE_SESSION_CAP,
  type SessionRouteDeps,
  type TokenRouteDeps,
} from './handlers';
import { signVoiceGrant, verifyVoiceToken } from './token';

// The two voice routes on fakes: the commands, which need the database, are tested in
// packages/domain; LiveKit's room service is a recording stand-in, so no test reaches LiveKit.

const ISSUER = 'https://bos.shakti.test';
const NOW = new Date('2026-11-17T06:00:00.000Z');
const LIVEKIT = {
  LIVEKIT_URL: 'wss://shakti-test.livekit.cloud',
  LIVEKIT_API_KEY: 'APItestkey',
  LIVEKIT_API_SECRET: 'a test secret that is long enough for the room tokens',
};

const person: Principal = {
  id: newId(),
  kind: 'user',
  roleKey: 'general_manager',
  entityIds: [1, 2],
  permissions: [{ key: 'voice.use', scope: 'all' }],
};

async function env(livekit = true, keys = true): Promise<Env> {
  return {
    BETTER_AUTH_URL: ISSUER,
    ...(keys ? { BOS_JWT_CURRENT_KEY: await newSigningKeyJson('current') } : {}),
    ...(livekit ? LIVEKIT : {}),
  };
}

async function keysOf(vars: Env): Promise<SigningKeys> {
  const keys = await parseSigningKeys(vars);
  if (keys === undefined) throw new Error('no keys');
  return keys;
}

async function envelope(response: Response) {
  return ErrorEnvelope.parse(await response.json()).error;
}

function grantFor(principal: Principal, over: Partial<VoiceSessionGrant> = {}): VoiceSessionGrant {
  return {
    sessionId: newId(),
    sub: principal.id,
    bos_role: 'general_manager',
    entity_ids: [1, 2],
    mode: 'ask',
    consentRecording: true,
    startedAt: NOW.toISOString(),
    notAfter: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
    limits: { minutesRemainingToday: 30, paiseRemainingToday: 20_000, maxSessionMinutes: 15 },
    endedSessionIds: [],
    ...over,
  };
}

function recordingRooms(options: { fail?: boolean; failDelete?: boolean } = {}) {
  const made: { name: string; options: AgentRoomOptions }[] = [];
  const deleted: string[] = [];
  const rooms = (): LiveKitRooms => ({
    createRoom: () => Promise.reject(new Error('not used')),
    deleteRoom(name) {
      if (options.failDelete === true) return Promise.reject(new Error('room service down'));
      deleted.push(name);
      return Promise.resolve({ ms: 1 });
    },
    listRooms: () => Promise.reject(new Error('not used')),
    createAgentRoom(name, roomOptions) {
      if (options.fail === true) return Promise.reject(new Error('room service down'));
      made.push({ name, options: roomOptions });
      return Promise.resolve({ ms: 1 });
    },
  });
  return { made, deleted, rooms };
}

function sessionDeps(vars: Env, over: Partial<SessionRouteDeps> = {}) {
  const started: unknown[] = [];
  const ended: { sessionId: string; endedAt: Date }[] = [];
  const { made, deleted, rooms } = recordingRooms();
  const deps: SessionRouteDeps = {
    principal: () => Promise.resolve(person),
    start: (principal, input) => {
      started.push(input);
      return Promise.resolve(
        grantFor(principal, { mode: input.mode === 'teach' ? 'teach' : 'ask' }),
      );
    },
    endUnopened: (sessionId, endedAt) => {
      ended.push({ sessionId, endedAt });
      return Promise.resolve();
    },
    keyValue: memoryKeyValue(),
    rooms,
    env: vars,
    now: () => NOW,
    ...over,
  };
  return { deps, started, made, deleted, ended };
}

function startRequest(body: unknown, headers: Record<string, string> = { origin: ISSUER }) {
  return new Request(`${ISSUER}/api/v1/voice/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/voice/session', () => {
  it('starts a session: the room with its worker, the join token and the worker token', async () => {
    const vars = await env();
    const { deps, started, made } = sessionDeps(vars);
    const response = await startVoiceSessionRoute(
      startRequest({ mode: 'teach', consentRecording: true }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = VoiceSessionResponse.parse(await response.json());
    expect(started).toEqual([{ mode: 'teach', consentRecording: true }]);
    expect(body.livekit).toMatchObject({ url: LIVEKIT.LIVEKIT_URL, roomName: body.sessionId });
    expect(body.limits).toEqual({ minutesRemainingToday: 30, maxSessionMinutes: 15 });
    // The room is named after the session and asks for the voice worker, handing it the token.
    expect(made).toHaveLength(1);
    expect(made[0]?.name).toBe(body.sessionId);
    expect(made[0]?.options).toMatchObject({ agentName: VOICE_AGENT_NAME, maxParticipants: 2 });
    const metadata = VoiceDispatchMetadata.parse(JSON.parse(made[0]?.options.agentMetadata ?? ''));
    expect(metadata).toMatchObject({
      sessionId: body.sessionId,
      apiBase: `${ISSUER}/api/v1`,
      mode: 'teach',
      consentRecording: true,
      bosToken: body.bosToken,
    });
    const claims = await verifyVoiceToken(body.bosToken.token, await keysOf(vars), ISSUER, NOW);
    expect(claims).toMatchObject({ sub: person.id, sid: body.sessionId, entity_ids: [1, 2] });
    // The person joins that room only, as themselves, for at most the session's length.
    const join = decodeJwt(body.livekit.participantToken);
    expect(join).toMatchObject({
      iss: LIVEKIT.LIVEKIT_API_KEY,
      sub: `user:${person.id}`,
      video: { roomJoin: true, room: body.sessionId, canPublishData: true },
    });
    expect((join.exp ?? 0) - (join.iat ?? 0)).toBe(15 * 60);
  });

  it('says voice is not set up without LiveKit or the signing keys, before anything is written', async () => {
    for (const vars of [await env(false), await env(true, false)]) {
      const { deps, started } = sessionDeps(vars);
      const response = await startVoiceSessionRoute(
        startRequest({ mode: 'ask', consentRecording: false }),
        deps,
      );
      expect(response.status).toBe(503);
      expect(await envelope(response)).toMatchObject({
        code: 'integration_unavailable',
        details: { reason: 'voice_unavailable' },
      });
      expect(started).toEqual([]);
    }
  });

  it('refuses another site, nobody signed in, an agent, and a body without the recording answer', async () => {
    const vars = await env();
    const other = sessionDeps(vars);
    expect(
      (await startVoiceSessionRoute(startRequest({}, { origin: 'https://evil.test' }), other.deps))
        .status,
    ).toBe(403);
    const nobody = sessionDeps(vars, { principal: () => Promise.resolve(undefined) });
    expect((await startVoiceSessionRoute(startRequest({ mode: 'ask' }), nobody.deps)).status).toBe(
      401,
    );
    const agent = sessionDeps(vars, {
      principal: () => Promise.resolve({ ...person, kind: 'agent', roleKey: 'agent:chief' }),
    });
    expect((await startVoiceSessionRoute(startRequest({ mode: 'ask' }), agent.deps)).status).toBe(
      403,
    );
    const { deps, started } = sessionDeps(vars);
    const response = await startVoiceSessionRoute(startRequest({ mode: 'ask' }), deps);
    expect(await envelope(response)).toMatchObject({ code: 'validation_failed' });
    expect(started).toEqual([]);
  });

  it("answers the day's limit with its reason, and caps starts per person", async () => {
    const vars = await env();
    const { deps, made } = sessionDeps(vars, {
      start: () =>
        Promise.reject(new DomainError('forbidden', 'limit', { reason: 'voice_cap_reached' })),
    });
    const response = await startVoiceSessionRoute(
      startRequest({ mode: 'ask', consentRecording: true }),
      deps,
    );
    expect(response.status).toBe(403);
    expect(await envelope(response)).toMatchObject({
      code: 'forbidden',
      details: { reason: 'voice_cap_reached' },
    });
    expect(made).toEqual([]);
    const capped = sessionDeps(vars);
    let last = 0;
    for (let i = 0; i <= VOICE_SESSION_CAP.max; i += 1) {
      last = (
        await startVoiceSessionRoute(
          startRequest({ mode: 'ask', consentRecording: true }),
          capped.deps,
        )
      ).status;
    }
    expect(last).toBe(429);
  });

  it('says voice is not set up when the room cannot be made, and ends that session at once', async () => {
    const vars = await env();
    const { rooms } = recordingRooms({ fail: true });
    const { deps, ended } = sessionDeps(vars, { rooms });
    const response = await startVoiceSessionRoute(
      startRequest({ mode: 'ask', consentRecording: true }),
      deps,
    );
    expect(await envelope(response)).toMatchObject({
      code: 'integration_unavailable',
      details: { reason: 'voice_unavailable' },
    });
    expect(ended).toHaveLength(1);
    expect(ended[0]?.endedAt).toEqual(NOW);
  });

  it("deletes the rooms of the person's earlier sessions the start ended, best effort", async () => {
    const vars = await env();
    const earlier = [newId(), newId()];
    const start: SessionRouteDeps['start'] = (principal) =>
      Promise.resolve(grantFor(principal, { endedSessionIds: earlier }));
    const { deps, deleted, made } = sessionDeps(vars, { start });
    const response = await startVoiceSessionRoute(
      startRequest({ mode: 'ask', consentRecording: true }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(deleted.sort()).toEqual([...earlier].sort());
    expect(made).toHaveLength(1);
    // LiveKit refusing the deletes never holds up the start.
    const { rooms, made: madeAnyway } = recordingRooms({ failDelete: true });
    const failing = sessionDeps(vars, { start, rooms });
    const still = await startVoiceSessionRoute(
      startRequest({ mode: 'ask', consentRecording: true }),
      failing.deps,
    );
    expect(still.status).toBe(200);
    expect(madeAnyway).toHaveLength(1);
  });

  it("gives the session's own length to its tokens, its room and its worker, with the day's spend left", async () => {
    const vars = await env();
    // Two minutes left today, and ₹35 of the day's spend.
    const start: SessionRouteDeps['start'] = (principal) =>
      Promise.resolve(
        grantFor(principal, {
          notAfter: new Date(NOW.getTime() + 2 * 60_000).toISOString(),
          limits: { minutesRemainingToday: 2, paiseRemainingToday: 3_500, maxSessionMinutes: 2 },
        }),
      );
    const { deps, made } = sessionDeps(vars, { start });
    const response = await startVoiceSessionRoute(
      startRequest({ mode: 'ask', consentRecording: false }),
      deps,
    );
    const body = VoiceSessionResponse.parse(await response.json());
    const metadata = VoiceDispatchMetadata.parse(JSON.parse(made[0]?.options.agentMetadata ?? ''));
    expect(metadata.notAfter).toBe(new Date(NOW.getTime() + 2 * 60_000).toISOString());
    expect(metadata.limits).toEqual({
      minutesRemainingToday: 2,
      paiseRemainingToday: 3_500,
      maxSessionMinutes: 2,
    });
    // The worker's token lives no longer than the session: its 5 minutes cut to 2.
    expect(new Date(body.bosToken.expiresAt).getTime()).toBe(NOW.getTime() + 2 * 60_000);
    const join = decodeJwt(body.livekit.participantToken);
    expect((join.exp ?? 0) - (join.iat ?? 0)).toBe(2 * 60);
  });
});

describe('POST /api/v1/voice/token', () => {
  const voice: Principal = { ...person, kind: 'voice_session', voiceSessionId: newId() };

  function tokenDeps(vars: Env, over: Partial<TokenRouteDeps> = {}) {
    const asked: string[] = [];
    const deps: TokenRouteDeps = {
      voicePrincipal: (token) => {
        asked.push(token);
        return Promise.resolve({ principal: voice });
      },
      refresh: (principal) =>
        Promise.resolve({
          jti: newId(),
          sub: principal.id,
          sid: principal.voiceSessionId ?? '',
          bos_role: 'general_manager',
          entity_ids: [1, 2],
          notAfter: new Date(NOW.getTime() + 120_000).toISOString(),
        }),
      keyValue: memoryKeyValue(),
      env: vars,
      now: () => NOW,
      ...over,
    };
    return { deps, asked };
  }

  const refresh = (token?: string, body = '{}') =>
    new Request(`${ISSUER}/api/v1/voice/token`, {
      method: 'POST',
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      body,
    });

  it('gives a new token for the live session, never past the session', async () => {
    const vars = await env();
    const current = await signVoiceGrant(
      {
        jti: newId(),
        sub: person.id,
        sid: voice.voiceSessionId ?? '',
        bos_role: 'general_manager',
        entity_ids: [1, 2],
      },
      new Date(NOW.getTime() + 600_000),
      await keysOf(vars),
      { issuer: ISSUER, now: NOW },
    );
    const { deps, asked } = tokenDeps(vars);
    const response = await refreshVoiceTokenRoute(refresh(current.token), deps);
    expect(response.status).toBe(200);
    const body = VoiceTokenResponse.parse(await response.json());
    expect(asked).toEqual([current.token]);
    const claims = await verifyVoiceToken(body.token, await keysOf(vars), ISSUER, NOW);
    expect(claims).toMatchObject({ sub: person.id, sid: voice.voiceSessionId });
    expect(body.expiresAt).toBe(new Date(NOW.getTime() + 120_000).toISOString());
  });

  it('refuses no token, a token for no live session, a body with fields and an ended session', async () => {
    const vars = await env();
    expect((await refreshVoiceTokenRoute(refresh(), tokenDeps(vars).deps)).status).toBe(401);
    const none = tokenDeps(vars, { voicePrincipal: () => Promise.resolve(undefined) });
    expect((await refreshVoiceTokenRoute(refresh('a.b.c'), none.deps)).status).toBe(401);
    const fields = await refreshVoiceTokenRoute(
      refresh('a.b.c', '{"sid":"x"}'),
      tokenDeps(vars).deps,
    );
    expect(await envelope(fields)).toMatchObject({ code: 'validation_failed' });
    const ended = tokenDeps(vars, {
      refresh: () =>
        Promise.reject(new DomainError('forbidden', 'ended', { reason: 'voice_session_ended' })),
    });
    const response = await refreshVoiceTokenRoute(refresh('a.b.c'), ended.deps);
    expect(await envelope(response)).toMatchObject({
      code: 'forbidden',
      details: { reason: 'voice_session_ended' },
    });
  });

  it('says voice is not set up without the signing keys', async () => {
    const response = await refreshVoiceTokenRoute(
      refresh('a.b.c'),
      tokenDeps(await env(true, false)).deps,
    );
    expect(await envelope(response)).toMatchObject({
      code: 'integration_unavailable',
      details: { reason: 'voice_unavailable' },
    });
  });
});
