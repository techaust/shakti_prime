import { newId, type Principal } from '@shakti/contracts';
import { asMigrator, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { executeCommand, startVoiceSession } from '@shakti/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { handleLiveKit } from '../src/workers/webhooks/livekit';
import { processWebhook } from '../src/workers/webhooks/process';

// V2's `livekit` handler on real Postgres (docs/03-roadmap-appendix/phase2.md §7.5): a finished
// room ends its session, the voice worker's report records spend, turn timings and a recorded
// Teach session's vault files, and a repeated, late or foreign event changes nothing. Every row
// here is found by this run's own ids.

afterAll(closeDb);

let person: Principal;

beforeAll(async () => {
  person = await createTestPrincipal('general_manager', [1]);
});

const start = (consentRecording: boolean) =>
  executeCommand(person, { entityIds: [1] }, startVoiceSession, {
    mode: 'teach',
    consentRecording,
  });

async function sessionRow(id: string) {
  const [row] = await asMigrator(
    (m) => m<
      {
        ended_at: Date | null;
        minutes: number | null;
        cost_paise: number;
        turn_stats_json: Record<string, unknown>;
        audio_file_id: string | null;
        transcript_file_id: string | null;
      }[]
    >`select ended_at, minutes, cost_paise, turn_stats_json, audio_file_id, transcript_file_id
        from voice_sessions where id = ${id}`,
  );
  return row;
}

async function vaultFile(owner: string): Promise<string> {
  const id = newId();
  await asMigrator(
    (
      m,
    ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
             values (${id}, 1, 'knowledge', 'test', ${`1/knowledge/${id}.wav`}, 'teach.wav', 'audio/wav', 1,
                     ${'d'.repeat(64)}, 'ready', ${owner})`,
  );
  return id;
}

const seconds = (iso: string) => String(Math.floor(new Date(iso).getTime() / 1000));

function event(
  sessionId: string,
  type: string,
  createdAt: string,
  participant?: Record<string, unknown>,
) {
  return {
    event: type,
    id: `EV_${newId()}`,
    createdAt,
    room: { sid: 'RM_voice', name: sessionId },
    ...(participant === undefined ? {} : { participant }),
  } as Parameters<typeof handleLiveKit>[0];
}

const report = (body: Record<string, unknown>) => ({
  sid: 'PA_worker',
  identity: 'agent-AJ_worker',
  kind: 'AGENT',
  metadata: JSON.stringify(body),
});

describe('the livekit handler', () => {
  it("records the end of a finished room, once, with its minutes from the session's times", async () => {
    const grant = await start(false);
    const endedAt = new Date(new Date(grant.startedAt).getTime() + 125_000).toISOString();
    const finished = event(grant.sessionId, 'room_finished', seconds(endedAt));
    expect(await handleLiveKit(finished, { requestId: newId() })).toEqual({ entityId: null });
    const row = await sessionRow(grant.sessionId);
    expect(row?.minutes).toBe(3);
    expect(row?.ended_at?.toISOString()).toBe(
      new Date(Number(seconds(endedAt)) * 1000).toISOString(),
    );
    // An earlier finish lowers nothing.
    await handleLiveKit(event(grant.sessionId, 'room_finished', seconds(grant.startedAt)), {
      requestId: newId(),
    });
    expect((await sessionRow(grant.sessionId))?.minutes).toBe(3);
    // A later one (a room that ran on after another start ended its session) raises the minutes,
    // at most to the session's own longest length, and keeps the end first recorded.
    const later = new Date(new Date(endedAt).getTime() + 3_600_000).toISOString();
    await handleLiveKit(event(grant.sessionId, 'room_finished', seconds(later)), {
      requestId: newId(),
    });
    const raised = await sessionRow(grant.sessionId);
    expect(raised?.minutes).toBe(grant.limits.maxSessionMinutes);
    expect(raised?.ended_at?.toISOString()).toBe(row?.ended_at?.toISOString());
  });

  it("records the worker's report and a recorded Teach session's files, never a person's", async () => {
    const grant = await start(true);
    const audio = await vaultFile(person.id);
    const transcript = await vaultFile(person.id);
    const turnStats = { turns: 6, steps: { first_audio: { p50Ms: 1_300, p95Ms: 2_100 } } };
    // The person leaving with metadata of their own records nothing.
    await handleLiveKit(
      event(grant.sessionId, 'participant_left', seconds(grant.startedAt), {
        ...report({ costPaise: 9_999, turnStats }),
        identity: `user:${person.id}`,
        kind: 'STANDARD',
      }),
      { requestId: newId() },
    );
    expect(await sessionRow(grant.sessionId)).toMatchObject({ cost_paise: 0, audio_file_id: null });
    await handleLiveKit(
      event(
        grant.sessionId,
        'participant_left',
        seconds(grant.startedAt),
        report({ costPaise: 1_250, turnStats, audioFileId: audio, transcriptFileId: transcript }),
      ),
      { requestId: newId() },
    );
    expect(await sessionRow(grant.sessionId)).toMatchObject({
      ended_at: null,
      cost_paise: 1_250,
      turn_stats_json: turnStats,
      audio_file_id: audio,
      transcript_file_id: transcript,
    });
  });

  it('keeps no file of a session without the recording answer', async () => {
    const grant = await start(false);
    const audio = await vaultFile(person.id);
    await handleLiveKit(
      event(
        grant.sessionId,
        'participant_left',
        seconds(grant.startedAt),
        report({ costPaise: 10, turnStats: { turns: 1, steps: {} }, audioFileId: audio }),
      ),
      { requestId: newId() },
    );
    expect(await sessionRow(grant.sessionId)).toMatchObject({
      cost_paise: 10,
      audio_file_id: null,
    });
  });

  it('records nothing for another event, a room of no session or an unreadable report', async () => {
    const grant = await start(false);
    for (const e of [
      event(grant.sessionId, 'room_started', seconds(grant.startedAt)),
      event('not-a-session', 'room_finished', seconds(grant.startedAt)),
      event(newId(), 'room_finished', seconds(grant.startedAt)),
      event(grant.sessionId, 'participant_left', seconds(grant.startedAt), {
        ...report({}),
        metadata: 'not json',
      }),
    ]) {
      expect(await handleLiveKit(e, { requestId: newId() })).toEqual({ entityId: null });
    }
    expect(await sessionRow(grant.sessionId)).toMatchObject({ ended_at: null, cost_paise: 0 });
  });

  it('runs from a stored delivery through the webhook worker, once', async () => {
    const grant = await start(false);
    const payload = event(grant.sessionId, 'room_finished', seconds(new Date().toISOString()));
    const id = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into webhook_inbox (id, provider, provider_event_id, payload_json, payload_sha256)
               values (${id}, 'livekit', ${payload.id}, ${JSON.stringify(payload)}::text::jsonb,
                       ${'c'.repeat(64)})`,
    );
    expect(await processWebhook(id, { requestId: newId() })).toEqual({
      inboxId: id,
      outcome: 'processed',
      handled: true,
    });
    expect((await sessionRow(grant.sessionId))?.ended_at).not.toBeNull();
    expect(await processWebhook(id, { requestId: newId() })).toEqual({
      inboxId: id,
      outcome: 'duplicate',
    });
  });
});
