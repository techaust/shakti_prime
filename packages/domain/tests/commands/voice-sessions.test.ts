import {
  newId,
  SYSTEM_MATRIX,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  VoiceSessionGrant,
  type Principal,
} from '@shakti/contracts';
import {
  asMigrator,
  closeDb,
  createTestPrincipal,
  createTestVoicePrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, describe, expect, it } from 'vitest';
import { AGENT_DEFAULTS } from '../../src/ai/agent-defaults';
import { voiceSessionPrincipal } from '../../src/auth/voice-principal';
import { executeCommand } from '../../src/command/execute';
import {
  recordVoiceSession,
  refreshVoiceToken,
  startVoiceSession,
} from '../../src/commands/voice/sessions';

// V2 Live voice (docs/03-roadmap-appendix/phase2.md §7.5, SECURITY §3.4): a person holding
// voice.use starts a session after the recording question, within the day's limits; the session's
// voice principal refreshes its token only while the session is live and its own; the platform
// records the end, minutes and spend. Every row here is found by this run's own ids.

afterAll(closeDb);

interface AuditRow {
  command: string;
  outcome: string;
  actor_principal_id: string;
  actor_kind: string;
  on_behalf_of_user_id: string | null;
  aggregate_id: string | null;
  entity_id: number | null;
  error_code: string | null;
  after_json: Record<string, unknown> | null;
}

function auditRows(requestId: string): Promise<AuditRow[]> {
  return asMigrator(
    (m) => m<AuditRow[]>`
      select command, outcome, actor_principal_id, actor_kind, on_behalf_of_user_id, aggregate_id,
             entity_id, error_code, after_json
        from audit_logs where request_id = ${requestId} order by created_at`,
  );
}

const workers: Principal = {
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
  roleKey: 'system:workers',
  entityIds: [],
  permissions: [...SYSTEM_MATRIX['system:workers']],
};

/** Starts a session for `person` in the given companies. */
function start(person: Principal, entityIds: readonly number[] = person.entityIds, input = {}) {
  return executeCommand(person, { entityIds }, startVoiceSession, {
    mode: 'ask',
    consentRecording: true,
    ...input,
  });
}

/** The session's voice principal, as the token route builds it from the person's grants. */
function voiceOf(person: Principal, grant: VoiceSessionGrant): Principal {
  const voice = voiceSessionPrincipal(person, grant.sessionId, grant.entity_ids);
  if (voice === undefined) throw new Error('no voice principal');
  return voice;
}

describe('voice.session.start', () => {
  it('is denied without voice.use, and to an agent or a voice session whatever they hold', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    await expect(start(caller)).rejects.toMatchObject({ code: 'forbidden' });
    const voice = await createTestVoicePrincipal('executive', [1]);
    await expect(start(voice)).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'people_only' },
    });
    const agent = principalFor('agent:chief', [1], {
      permissions: [{ key: 'voice.use', scope: 'all' }],
    });
    await expect(start(agent)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a company outside the request', async () => {
    const gm = await createTestPrincipal('general_manager', [1, 2]);
    await expect(start(gm, [1], { entityId: 2 })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a session without the recording answer, and in command mode', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    await expect(
      executeCommand(exec, { entityIds: [1] }, startVoiceSession, { mode: 'ask' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(start(exec, [1], { mode: 'command' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('opens a session for the person and records who, how and with what answer', async () => {
    const gm = await createTestPrincipal('general_manager', [1, 2]);
    const requestId = newId();
    const grant = await executeCommand(gm, { entityIds: [2, 1], requestId }, startVoiceSession, {
      mode: 'teach',
      consentRecording: false,
    });
    expect(VoiceSessionGrant.parse(grant)).toEqual({
      sessionId: grant.sessionId,
      sub: gm.id,
      bos_role: 'general_manager',
      entity_ids: [1, 2],
      mode: 'teach',
      consentRecording: false,
      startedAt: grant.startedAt,
      notAfter: new Date(
        new Date(grant.startedAt).getTime() + AGENT_DEFAULTS.voice.sessionMaxMinutes * 60_000,
      ).toISOString(),
      limits: {
        minutesRemainingToday: AGENT_DEFAULTS.voice.personDailyMinutes,
        paiseRemainingToday: AGENT_DEFAULTS.voice.personDailyCapPaise,
        maxSessionMinutes: AGENT_DEFAULTS.voice.sessionMaxMinutes,
      },
      endedSessionIds: [],
    });
    expect(await auditRows(requestId)).toEqual([
      {
        command: 'voice.session.start',
        outcome: 'ok',
        actor_principal_id: gm.id,
        actor_kind: 'user',
        on_behalf_of_user_id: null,
        aggregate_id: grant.sessionId,
        entity_id: null,
        error_code: null,
        after_json: { mode: 'teach', consentRecording: false, entityIds: [1, 2] },
      },
    ]);
    // Narrowed to one company, the session is that company's.
    const narrowed = await start(gm, [1, 2], { entityId: 2 });
    expect(narrowed.entity_ids).toEqual([2]);
  });

  it("stops at the day's limit, and gives a session no longer than the minutes left", async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const earlier = newId();
    await asMigrator(async (m) => {
      await m`insert into principals (id, kind, display_name) values (${earlier}, 'voice_session', 'test voice')`;
      await m`insert into voice_sessions (id, user_id, entity_id, entity_ids, mode, consent_recording, started_at, ended_at, minutes, max_minutes)
              values (${earlier}, ${exec.id}, 1, '{1}', 'ask', false, now(), now(), 24, 15)`;
    });
    const grant = await start(exec);
    expect(grant.limits).toMatchObject({ minutesRemainingToday: 6, maxSessionMinutes: 6 });
    await asMigrator(
      (m) =>
        m`update voice_sessions set ended_at = now(), minutes = 6 where id = ${grant.sessionId}`,
    );
    const requestId = newId();
    await expect(
      executeCommand(exec, { entityIds: [1], requestId }, startVoiceSession, {
        mode: 'ask',
        consentRecording: true,
      }),
    ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'voice_cap_reached' } });
    expect((await auditRows(requestId)).map((r) => [r.outcome, r.error_code])).toEqual([
      ['denied', 'forbidden'],
    ]);
  });
});

describe("a session's own longest length", () => {
  it('holds its tokens, its live check and its refresh to the minutes left when fewer', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const earlier = newId();
    // 28 of the day's 30 minutes and ₹165 of the day's ₹200 used.
    await asMigrator(async (m) => {
      await m`insert into principals (id, kind, display_name) values (${earlier}, 'voice_session', 'test voice')`;
      await m`insert into voice_sessions (id, user_id, entity_id, entity_ids, mode, consent_recording, started_at, ended_at, minutes, cost_paise, max_minutes)
              values (${earlier}, ${exec.id}, 1, '{1}', 'ask', false, now(), now(), 28, 16500, 15)`;
    });
    const grant = await start(exec);
    const startedAt = new Date(grant.startedAt).getTime();
    expect(grant.limits).toEqual({
      minutesRemainingToday: 2,
      paiseRemainingToday: 3_500,
      maxSessionMinutes: 2,
    });
    expect(grant.notAfter).toBe(new Date(startedAt + 2 * 60_000).toISOString());
    const voice = voiceOf(exec, grant);
    const token = await executeCommand(voice, { entityIds: [1] }, refreshVoiceToken, {});
    expect(token.notAfter).toBe(grant.notAfter);
    // Three minutes on, the 2-minute session is no longer live, though a session's longest is 15.
    await asMigrator(
      (m) =>
        m`update voice_sessions set started_at = now() - interval '3 minutes' where id = ${grant.sessionId}`,
    );
    await expect(
      executeCommand(voice, { entityIds: [1] }, refreshVoiceToken, {}),
    ).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'voice_session_ended' } });
  });

  it('answers the earlier session it ended, whose room the route deletes', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const first = await start(exec);
    expect(first.endedSessionIds).toEqual([]);
    const second = await start(exec);
    expect(second.endedSessionIds).toEqual([first.sessionId]);
  });
});

describe('voice.session.token', () => {
  it('settles a new token for a live session of its own person, audited as the session', async () => {
    const exec = await createTestPrincipal('executive', [1, 3]);
    const grant = await start(exec);
    const voice = voiceOf(exec, grant);
    const requestId = newId();
    const token = await executeCommand(
      voice,
      { entityIds: voice.entityIds, requestId },
      refreshVoiceToken,
      {},
    );
    expect(token).toMatchObject({
      sub: exec.id,
      sid: grant.sessionId,
      bos_role: 'executive',
      entity_ids: [1, 3],
    });
    expect(new Date(token.notAfter).getTime()).toBe(
      new Date(grant.startedAt).getTime() + AGENT_DEFAULTS.voice.sessionMaxMinutes * 60_000,
    );
    expect(await auditRows(requestId)).toEqual([
      expect.objectContaining({
        command: 'voice.session.token',
        outcome: 'ok',
        actor_principal_id: grant.sessionId,
        actor_kind: 'voice_session',
        on_behalf_of_user_id: exec.id,
        aggregate_id: grant.sessionId,
      }),
    ]);
  });

  it('is refused to the person themselves, and for a session that is not live or not theirs', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    await expect(
      executeCommand(exec, { entityIds: [1] }, refreshVoiceToken, {}),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const ended = { reason: 'voice_session_ended' };
    // Another person's session named by this person's voice principal.
    const other = await createTestPrincipal('executive', [1]);
    const theirs = await start(other);
    const borrowed = voiceOf(exec, { ...theirs, entity_ids: [1] });
    await expect(
      executeCommand(borrowed, { entityIds: [1] }, refreshVoiceToken, {}),
    ).rejects.toMatchObject({ code: 'forbidden', details: ended });
    // Past its longest length.
    const old = await start(exec);
    await asMigrator(
      (m) =>
        m`update voice_sessions set started_at = now() - interval '16 minutes' where id = ${old.sessionId}`,
    );
    await expect(
      executeCommand(voiceOf(exec, old), { entityIds: [1] }, refreshVoiceToken, {}),
    ).rejects.toMatchObject({ code: 'forbidden', details: ended });
    // A request narrowed to one company of a session over two does not read the session.
    const gm = await createTestPrincipal('general_manager', [1, 2]);
    const both = voiceOf(gm, await start(gm, [1, 2]));
    await expect(
      executeCommand(both, { entityIds: [2] }, refreshVoiceToken, {}),
    ).rejects.toMatchObject({ code: 'forbidden', details: ended });
    // Ended: a new session ends the person's earlier one.
    const first = await start(exec);
    await start(exec);
    await expect(
      executeCommand(voiceOf(exec, first), { entityIds: [1] }, refreshVoiceToken, {}),
    ).rejects.toMatchObject({ code: 'forbidden', details: ended });
  });
});

describe('voice.session.record', () => {
  it('is denied to a person, an Executive included', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const grant = await start(exec);
    await expect(
      executeCommand(exec, { entityIds: [1] }, recordVoiceSession, {
        sessionId: grant.sessionId,
        minutes: 1,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('records the end, minutes and spend for the platform once, with no company', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const grant = await start(exec);
    const endedAt = new Date(new Date(grant.startedAt).getTime() + 150_000).toISOString();
    const requestId = newId();
    const input = {
      sessionId: grant.sessionId,
      endedAt,
      costPaise: 840,
      turnStats: { turns: 4, steps: { first_audio: { p50Ms: 1_200, p95Ms: 1_900 } } },
    };
    expect(await executeCommand(workers, { requestId }, recordVoiceSession, input)).toEqual({
      sessionId: grant.sessionId,
      outcome: 'recorded',
      endedAt,
      minutes: 3,
      costPaise: 840,
      filesLinked: true,
    });
    expect(await auditRows(requestId)).toEqual([
      expect.objectContaining({
        command: 'voice.session.record',
        actor_kind: 'system',
        entity_id: null,
        after_json: { endedAt, minutes: 3, costPaise: 840, turns: 4 },
      }),
    ]);
    // The same event again changes nothing and writes no row.
    const again = newId();
    expect(
      await executeCommand(workers, { requestId: again }, recordVoiceSession, input),
    ).toMatchObject({ outcome: 'unchanged', minutes: 3 });
    expect(await auditRows(again)).toEqual([]);
    expect(
      await executeCommand(workers, {}, recordVoiceSession, { sessionId: newId(), minutes: 1 }),
    ).toMatchObject({ outcome: 'missing' });
  });
});
