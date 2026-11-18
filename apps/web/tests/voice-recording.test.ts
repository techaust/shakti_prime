import { ErrorEnvelope, type Principal } from '@shakti/contracts';
import { asMigrator, closeDb, createTestPrincipal } from '@shakti/db/testing';
import {
  executeCommand,
  memoryFileStore,
  sha256Hex,
  startVoiceSession,
  voiceSessionPrincipal,
} from '@shakti/domain';
import { afterAll, describe, expect, it } from 'vitest';
import { completeUploadFor, presignUpload } from '../src/files/uploads';
import { voiceRecordingCompleteRoute, voiceRecordingRoute } from '../src/voice/recording';
import { recordingRouteDeps } from '../src/voice/route-deps';

// A recorded Teach session's audio on real Postgres (docs/03-roadmap-appendix/phase2.md §7.5): the
// worker's voice token gets one upload address per session, the bytes land in the store, and the
// BOS files them as an Executive-only vault file of the person (K3's `knowledge.file.add`, as the
// voice principal) and links them to the session. The token is stood in for (its checks are tested
// in src/voice and src/auth); the store is the in-memory one; the rest is real.

afterAll(closeDb);

const store = memoryFileStore('test-bucket');
const ISSUER = 'http://localhost:3000';

async function sessionOf(person: Principal, consentRecording: boolean, mode = 'teach') {
  const grant = await executeCommand(person, { entityIds: [1] }, startVoiceSession, {
    mode,
    consentRecording,
  });
  const voice = voiceSessionPrincipal(person, grant.sessionId, grant.entity_ids);
  if (voice === undefined) throw new Error('no voice principal');
  return { grant, voice };
}

function deps(voice: Principal | undefined) {
  return {
    ...recordingRouteDeps(),
    // No outbox nudge: the file checks would run in this process on the development store.
    options: (_meta: unknown, idempotencyKey?: string) =>
      idempotencyKey === undefined ? {} : { idempotencyKey },
    voicePrincipal: () => Promise.resolve(voice === undefined ? undefined : { principal: voice }),
    presign: (
      p: Principal,
      input: Parameters<typeof presignUpload>[1],
      call: Parameters<typeof presignUpload>[2],
    ) => presignUpload(p, input, call, store),
    complete: (p: Principal, fileId: string, call: Parameters<typeof presignUpload>[2]) =>
      completeUploadFor(p, fileId, 'knowledge', call, store),
  };
}

const post = (path: string, body: unknown) =>
  new Request(`${ISSUER}/api/v1/voice/${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer voice.token.here', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** A short WAV: the 44-byte header and a little silence at 8 kHz. */
function wav(): Uint8Array {
  const samples = 800;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  return bytes;
}

async function failure(response: Response) {
  return { status: response.status, error: ErrorEnvelope.parse(await response.json()).error };
}

describe('a recorded Teach session', () => {
  it('uploads once, then files the audio as Executive only and links it to the session', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const { grant, voice } = await sessionOf(exec, true);
    const bytes = wav();
    const body = { size: bytes.length, sha256: sha256Hex(bytes) };
    const first = await voiceRecordingRoute(post('recording', body), deps(voice));
    expect(first.status).toBe(200);
    const slot = (await first.json()) as { fileId: string; uploadUrl: string };
    // Asked again for the same recording, the same file; for other bytes, refused.
    const again = (await (
      await voiceRecordingRoute(post('recording', body), deps(voice))
    ).json()) as {
      fileId: string;
    };
    expect(again.fileId).toBe(slot.fileId);
    const other = await voiceRecordingRoute(
      post('recording', { size: bytes.length + 2, sha256: 'a'.repeat(64) }),
      deps(voice),
    );
    expect((await failure(other)).error.code).toBe('conflict');

    const [, key] =
      /\/(1\/knowledge\/[0-9a-f-]+\.wav)$/.exec(new URL(slot.uploadUrl).pathname) ?? [];
    await store.put(key ?? `1/knowledge/${slot.fileId}.wav`, bytes, 'audio/wav');
    const done = await voiceRecordingCompleteRoute(
      post('recording/complete', { fileId: slot.fileId }),
      deps(voice),
    );
    expect(done.status).toBe(200);
    const filed = (await done.json()) as { knowledgeFileId: string; linked: boolean };
    expect(filed.linked).toBe(true);
    const [row] = await asMigrator(
      (m) => m<{ sensitivity: string; created_by: string; audio_file_id: string }[]>`
        select k.sensitivity, k.created_by, v.audio_file_id
          from knowledge_files k join voice_sessions v on v.audio_file_id = k.file_id
         where k.id = ${filed.knowledgeFileId} and v.id = ${grant.sessionId}`,
    );
    expect(row).toEqual({
      sensitivity: 'exec_only',
      created_by: exec.id,
      audio_file_id: slot.fileId,
    });
    // The vault filing is audited as the session, with the person beside it.
    const [audit] = await asMigrator(
      (m) => m<{ actor_principal_id: string; on_behalf_of_user_id: string }[]>`
        select actor_principal_id, on_behalf_of_user_id from audit_logs
         where command = 'knowledge.file.add' and aggregate_id = ${filed.knowledgeFileId}`,
    );
    expect(audit).toEqual({ actor_principal_id: grant.sessionId, on_behalf_of_user_id: exec.id });
    // A second recording of the session is refused.
    const twice = await voiceRecordingRoute(post('recording', body), deps(voice));
    expect(await failure(twice)).toMatchObject({
      status: 409,
      error: { details: { reason: 'voice_recording_refused' } },
    });
  });

  it('completes only the file begun for the session, never another upload of the person', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const { grant, voice } = await sessionOf(exec, true);
    const bytes = wav();
    // Another knowledge upload of the person's own, begun on their own sign-in.
    const own = await presignUpload(
      exec,
      {
        entityId: 1,
        purpose: 'knowledge',
        name: 'price list.wav',
        contentType: 'audio/wav',
        size: bytes.length,
        sha256: sha256Hex(bytes),
      },
      { requestId: crypto.randomUUID(), options: {} },
      store,
    );
    const refusal = { status: 403, error: { details: { reason: 'voice_recording_refused' } } };
    // Before the session's own upload is begun, and after it, the other file is refused.
    expect(
      await failure(
        await voiceRecordingCompleteRoute(
          post('recording/complete', { fileId: own.fileId }),
          deps(voice),
        ),
      ),
    ).toMatchObject(refusal);
    const body = { size: bytes.length, sha256: sha256Hex(bytes) };
    const slot = (await (
      await voiceRecordingRoute(post('recording', body), deps(voice))
    ).json()) as { fileId: string };
    expect(slot.fileId).not.toBe(own.fileId);
    expect(
      await failure(
        await voiceRecordingCompleteRoute(
          post('recording/complete', { fileId: own.fileId }),
          deps(voice),
        ),
      ),
    ).toMatchObject(refusal);
    // Nothing was filed or linked.
    const [filed] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from knowledge_files where file_id = ${own.fileId}`,
    );
    expect(filed?.n).toBe(0);
    const [linked] = await asMigrator(
      (m) => m<{ audio_file_id: string | null }[]>`
        select audio_file_id from voice_sessions where id = ${grant.sessionId}`,
    );
    expect(linked?.audio_file_id).toBeNull();
  });

  it('is refused without the recording answer, in Ask, to a GM, and without a live session', async () => {
    const bytes = wav();
    const body = { size: bytes.length, sha256: sha256Hex(bytes) };
    const exec = await createTestPrincipal('executive', [1]);
    for (const [consent, mode] of [
      [false, 'teach'],
      [true, 'ask'],
    ] as const) {
      const { voice } = await sessionOf(exec, consent, mode);
      expect(
        await failure(await voiceRecordingRoute(post('recording', body), deps(voice))),
      ).toMatchObject({ status: 403, error: { details: { reason: 'voice_recording_refused' } } });
    }
    // A GM reads no Executive-only file, so files none.
    const gm = await createTestPrincipal('general_manager', [1]);
    const { voice: gmVoice } = await sessionOf(gm, true);
    expect(
      (await failure(await voiceRecordingRoute(post('recording', body), deps(gmVoice)))).status,
    ).toBe(403);
    // No token, or a session that has ended.
    expect((await voiceRecordingRoute(post('recording', body), deps(undefined))).status).toBe(401);
    const { grant, voice } = await sessionOf(exec, true);
    await asMigrator(
      (m) =>
        m`update voice_sessions set ended_at = now(), minutes = 1 where id = ${grant.sessionId}`,
    );
    expect(
      await failure(await voiceRecordingRoute(post('recording', body), deps(voice))),
    ).toMatchObject({ status: 403, error: { details: { reason: 'voice_session_ended' } } });
  });
});
