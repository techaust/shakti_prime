import {
  newId,
  SYSTEM_MATRIX,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type EmbeddingsIndexJob,
  type KnowledgeSensitivity,
  type Principal,
} from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { output, ZodType } from 'zod';
import { createAiProvider, spendKey } from '../../src/ai/provider';
import { fakeEmbedding, fakeModelTransport, ModelCallError } from '../../src/ai/transport';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { executeQuery } from '../../src/command/execute';
import type { Command } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { addKnowledgeFile, archiveKnowledgeFile } from '../../src/commands/knowledge/files';
import {
  correctKnowledgeTranscript,
  recordKnowledgeTranscript,
} from '../../src/commands/knowledge/transcript';
import { KnowledgeExtractError } from '../../src/knowledge/extract';
import {
  indexKnowledgeFile,
  type IndexKnowledgeDeps,
  type RecordingTranscriber,
} from '../../src/knowledge/index-file';
import { istCalendarDate } from '../../src/numbering/financial-year';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { memoryFileStore, sha256Hex } from '../../src/ports/file-store';
import { memoryKeyValue, type KeyValue } from '../../src/ports/key-value';
import { memoryLogger } from '../../src/ports/logger';
import { getKnowledgeFile, searchKnowledge } from '../../src/queries/knowledge/vault';

// Vault recordings on real Postgres (docs/03-roadmap-appendix/phase2.md §6.4, K3): the index job
// transcribes a recording through the speech service it is given (a fake here, as recorded
// responses would be; nothing reaches a vendor), keeps the masked transcript, and cuts it into
// passages; a person's correction replaces it and the passages. Every text is synthetic.

afterAll(closeDb);

/** A word no earlier run wrote, so this run's passages rank first in its own searches. */
const RUN = `rec${Date.now().toString(36)}`;
/** A synthetic Aadhaar number that passes its check digit, which must never be stored. */
const AADHAAR = '2345 6789 0124';

let executive: Principal;
let gm: Principal;
let caller: Principal;
const store = memoryFileStore('memory');

const workers = (entityId: number): Principal => ({
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
  roleKey: 'system:workers',
  entityIds: [entityId],
  permissions: [...SYSTEM_MATRIX['system:workers']],
});

beforeAll(async () => {
  executive = await createTestPrincipal('executive');
  gm = await createTestPrincipal('general_manager', [1]);
  caller = await createTestPrincipal('tele_caller_cc', [1]);
});

const run = <I extends ZodType, O extends ZodType>(
  principal: Principal,
  command: Command<I, O>,
  input: unknown,
): Promise<output<O>> =>
  asPrincipal(principal, (context) => runCommand(command, { context, audit, outbox }, input));

/** A vault upload of `uploader` that passed its checks: a recording unless it says otherwise. */
async function upload(
  uploader: Principal,
  options: { entityId?: number; contentType?: string; sanitising?: string } = {},
): Promise<string> {
  const id = newId();
  const entityId = options.entityId ?? 1;
  const contentType = options.contentType ?? 'audio/wav';
  const bytes = new TextEncoder().encode(`RIFF recording ${id}`);
  const key = `${String(entityId)}/knowledge/${id}.wav`;
  await store.put(key, bytes, contentType);
  await asMigrator(
    (
      m,
    ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by, scan_result)
      values (${id}, ${entityId}, 'knowledge', ${store.bucket}, ${key}, 'vault recording', ${contentType},
              ${bytes.length}, ${sha256Hex(bytes)}, 'ready', ${uploader.id},
              ${JSON.stringify({ sanitising: options.sanitising ?? 'audio_checked' })}::jsonb)`,
  );
  return id;
}

const add = (
  principal: Principal,
  fileId: string,
  over: { sensitivity?: KnowledgeSensitivity; entityId?: number } = {},
) =>
  run(principal, addKnowledgeFile, {
    entityId: over.entityId ?? 1,
    fileId,
    title: 'Site visit notes',
    sensitivity: over.sensitivity ?? 'staff_ai_ok',
  });

/** The speech service as recorded responses stand in for it: one transcript per call, in order. */
function fakeTranscriber(
  answers: readonly (string | Error)[],
  audioMs = 90_000,
): RecordingTranscriber & { calls: number } {
  const speech = {
    vendor: 'sarvam',
    // ₹30 an hour, Sarvam's published price.
    paisePerHour: 3_000,
    calls: 0,
    durationMs: () => audioMs,
    transcribe(_bytes: Uint8Array, options: { sent: (ms: number) => void }) {
      const answer = answers[speech.calls] ?? '';
      speech.calls += 1;
      options.sent(audioMs);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  return speech;
}

function provider(options: { keyValue?: KeyValue; failEmbed?: boolean } = {}) {
  const transport = fakeModelTransport();
  // A vendor that refuses every embedding, once the transcript is kept.
  const refusing = {
    ...transport,
    embed: () => Promise.reject(new ModelCallError('http', { status: 400 })),
  };
  const keyValue = options.keyValue ?? memoryKeyValue();
  return {
    transport,
    keyValue,
    provider: createAiProvider({
      claude: transport,
      voyage: options.failEmbed === true ? refusing : transport,
      keyValue,
      logger: memoryLogger(),
      retries: 0,
    }),
  };
}

function job(knowledgeFileId: string, fileEntityId = 1): EmbeddingsIndexJob {
  return {
    eventId: newId(),
    knowledgeFileId,
    entityId: fileEntityId,
    fileEntityId,
    sensitivity: 'staff_ai_ok',
  };
}

const index = (knowledgeFileId: string, over: Partial<IndexKnowledgeDeps>, fileEntityId = 1) =>
  indexKnowledgeFile(job(knowledgeFileId, fileEntityId), {
    principal: workers(fileEntityId),
    store,
    provider: provider().provider,
    readWord: () => Promise.resolve(''),
    pdfPages: () => Promise.resolve([]),
    requestId: newId(),
    hosted: false,
    logger: memoryLogger(),
    ...over,
  });

async function fileRow(id: string) {
  const [row] = await asMigrator(
    (m) => m<
      {
        state: string;
        chunks: number;
        error_reason: string | null;
        transcript: string | null;
        transcript_corrected_at: Date | null;
      }[]
    >`select state, chunks, error_reason, transcript, transcript_corrected_at
        from knowledge_files where id = ${id}`,
  );
  return row;
}

async function chunkTexts(id: string): Promise<string[]> {
  const rows = await asMigrator(
    (m) => m<{ chunk_text: string }[]>`
      select chunk_text from knowledge_chunks where knowledge_file_id = ${id} order by position`,
  );
  return rows.map((r) => r.chunk_text);
}

/** A recording added by the GM and read once, with the transcript the speech service gave. */
async function indexedRecording(heard: string) {
  const vault = await add(gm, await upload(gm));
  await index(vault.id, { transcriber: fakeTranscriber([heard]) });
  return vault;
}

describe('the index job and a vault recording', () => {
  it('transcribes it, keeps the masked transcript, and its passages are found by search', async () => {
    const vault = await add(gm, await upload(gm));
    expect(vault).toMatchObject({ sourceType: 'audio', state: 'waiting' });
    const speech = fakeTranscriber([
      `Borewell ${RUN} pump ki service har chhe mahine. Mera aadhaar ${AADHAAR} hai, phone 9876543210.`,
    ]);
    const ai = provider();
    expect(await index(vault.id, { transcriber: speech, provider: ai.provider })).toMatchObject({
      chunks: 1,
      replaced: 0,
    });
    expect(speech.calls).toBe(1);
    const row = await fileRow(vault.id);
    expect(row).toMatchObject({ state: 'indexed', chunks: 1, transcript_corrected_at: null });
    expect(row?.transcript).toContain(`Borewell ${RUN} pump`);
    for (const text of [row?.transcript ?? '', ...(await chunkTexts(vault.id))]) {
      expect(text).not.toContain('6789');
      expect(text).not.toContain('9876543210');
    }
    // Only the masked text reached the embeddings; no model read the recording.
    expect(ai.transport.embeddings[0]?.texts.join(' ')).not.toContain('6789');
    expect(ai.transport.requests).toHaveLength(0);
    // Ninety seconds at ₹30 an hour: 75 paise, in the index's spend and in transcribing's part.
    const day = istCalendarDate(new Date());
    expect(await ai.keyValue.get(spendKey('knowledge:index', null, day))).not.toBeNull();
    expect(await ai.keyValue.get(`ai:spend:knowledge:index:part:transcribe:${day}`)).toBe('75');

    const hits = await executeQuery(
      caller,
      { entityIds: [1] },
      (ctx) => searchKnowledge(ctx, fakeEmbedding(`borewell ${RUN} pump ki service`)),
      { name: 'test.searchKnowledge' },
    );
    expect(hits.some((h) => h.knowledgeFileId === vault.id)).toBe(true);
  });

  it('reads a kept transcript again on a retry, and never pays for the recording twice', async () => {
    const vault = await add(gm, await upload(gm));
    const speech = fakeTranscriber([`Solar panel ${RUN} ki safai roz subah.`]);
    // The transcript is kept, then the embeddings fail: the delivery is tried again.
    await expect(
      index(vault.id, { transcriber: speech, provider: provider({ failEmbed: true }).provider }),
    ).rejects.toMatchObject({ code: 'integration_unavailable' });
    expect(await fileRow(vault.id)).toMatchObject({ state: 'waiting' });
    expect((await fileRow(vault.id))?.transcript).toContain('Solar panel');
    // Tried again: the kept transcript is read, the speech service is not called.
    await index(vault.id, { transcriber: speech });
    expect(speech.calls).toBe(1);
    expect(await fileRow(vault.id)).toMatchObject({ state: 'indexed', chunks: 1 });
    // A later delivery of the same transcript keeps the first one.
    expect(
      await run(workers(1), recordKnowledgeTranscript, {
        entityId: 1,
        knowledgeFileId: vault.id,
        transcript: 'Another transcript',
      }),
    ).toEqual({ knowledgeFileId: vault.id, stored: false });
  });

  it('waits without the speech service, refuses a recording too long, and stops at the cap', async () => {
    const waiting = await add(gm, await upload(gm));
    await index(waiting.id, { transcriber: undefined });
    expect(await fileRow(waiting.id)).toMatchObject({
      state: 'unavailable',
      error_reason: 'knowledge_service_missing',
      transcript: null,
    });

    const long = await add(gm, await upload(gm));
    const tooLong = fakeTranscriber(['never heard'], 30 * 60 * 1000 + 1);
    await index(long.id, { transcriber: tooLong });
    expect(tooLong.calls).toBe(0);
    expect(await fileRow(long.id)).toMatchObject({
      state: 'failed',
      error_reason: 'knowledge_too_long',
    });

    // Transcribing's own cap is used up, while the index's is not: nothing is sent.
    const keyValue = memoryKeyValue();
    await keyValue.incrBy(
      `ai:spend:knowledge:index:part:transcribe:${istCalendarDate(new Date())}`,
      30_000,
      3_600,
    );
    const capped = await add(gm, await upload(gm));
    const speech = fakeTranscriber(['never heard']);
    await index(capped.id, { transcriber: speech, provider: provider({ keyValue }).provider });
    expect(speech.calls).toBe(0);
    expect(await fileRow(capped.id)).toMatchObject({
      state: 'failed',
      error_reason: 'knowledge_spend_cap_reached',
    });
  });

  it('keeps no transcript in another script, nor an empty one, nor one the service could not read', async () => {
    const devanagari = await add(gm, await upload(gm));
    // "Pump" written in Devanagari, built from code points so this file holds none.
    await index(devanagari.id, {
      transcriber: fakeTranscriber([String.fromCodePoint(0x092a, 0x0902, 0x092a)]),
    });
    expect(await fileRow(devanagari.id)).toMatchObject({
      state: 'failed',
      error_reason: 'knowledge_unreadable',
      transcript: null,
    });

    const silent = await add(gm, await upload(gm));
    await index(silent.id, { transcriber: fakeTranscriber(['   ']) });
    expect(await fileRow(silent.id)).toMatchObject({
      state: 'failed',
      error_reason: 'knowledge_empty',
      transcript: null,
    });

    const refused = await add(gm, await upload(gm));
    await index(refused.id, {
      transcriber: fakeTranscriber([new KnowledgeExtractError('knowledge_unreadable', 'refused')]),
    });
    expect(await fileRow(refused.id)).toMatchObject({
      state: 'failed',
      error_reason: 'knowledge_unreadable',
    });
  });

  it('knowledge.file.record_transcript is the workers’ alone, in the upload’s company', async () => {
    const vault = await add(gm, await upload(gm));
    const input = { entityId: 1, knowledgeFileId: vault.id, transcript: 'Kept by a person' };
    await expect(run(gm, recordKnowledgeTranscript, input)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      run(workers(2), recordKnowledgeTranscript, { ...input, entityId: 2 }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect((await fileRow(vault.id))?.transcript).toBeNull();
  });
});

describe('knowledge.transcript.correct', () => {
  it('is refused to a reader, and in another company', async () => {
    const vault = await indexedRecording(`Motor ${RUN} ki wiring`);
    const input = { entityId: 1, knowledgeFileId: vault.id, transcript: 'Motor ki wiring theek' };
    // The caller reads the file (staff knowledge) but may not change it.
    await expect(run(caller, correctKnowledgeTranscript, input)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const gmOfTwo = await createTestPrincipal('general_manager', [2]);
    await expect(
      run(gmOfTwo, correctKnowledgeTranscript, { ...input, entityId: 2 }),
    ).rejects.toMatchObject({ code: 'not_found' });
    // A GM may not correct an Executive-only recording, which they cannot read.
    const secret = await add(executive, await upload(executive), { sensitivity: 'exec_only' });
    await index(secret.id, { transcriber: fakeTranscriber(['Board ki baat']) });
    await expect(
      run(gm, correctKnowledgeTranscript, { ...input, knowledgeFileId: secret.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect((await fileRow(vault.id))?.transcript).toBe(`Motor ${RUN} ki wiring`);
  });

  it('replaces the transcript, masked, and the passages once the file is read again', async () => {
    const vault = await indexedRecording(`Pump ${RUN} ka head sau meter, Marwari mein galat suna`);
    const before = await chunkTexts(vault.id);
    expect(before.join(' ')).toContain('galat suna');

    const corrected = `Pump ${RUN} ka head 120 meter hai. Customer ka aadhaar ${AADHAAR} likha tha.`;
    const requestId = newId();
    const answer = await asPrincipal(gm, (context) =>
      runCommand(
        correctKnowledgeTranscript,
        { context: { ...context, requestId }, audit, outbox },
        { entityId: 1, knowledgeFileId: vault.id, transcript: corrected },
      ),
    );
    expect(answer).toMatchObject({ id: vault.id, state: 'waiting' });
    // The answer is the transcript as kept, its numbers covered, for the screen to show at once.
    expect(answer.transcript).toContain('ka head 120 meter hai');
    expect(answer.transcript).not.toContain('6789');
    expect(answer.transcriptCorrectedAt).not.toBeNull();
    const row = await fileRow(vault.id);
    expect(row?.transcript).toContain('ka head 120 meter hai');
    expect(row?.transcript).not.toContain('6789');
    expect(row?.transcript_corrected_at).not.toBeNull();
    // The old passages stay in search until the new ones replace them.
    expect(await chunkTexts(vault.id)).toEqual(before);

    const events = await asOutboxPublisher(
      (p) => p<{ type: string }[]>`
        select type from outbox_events where aggregate_id = ${vault.id} order by sequence`,
    );
    expect(events.map((e) => e.type)).toEqual([
      'knowledge.file.index_requested',
      'knowledge.file.index_requested',
    ]);
    const [entry] = await asMigrator(
      (m) => m<{ input_json: unknown; before_json: unknown; after_json: unknown }[]>`
        select input_json, before_json, after_json from audit_logs
         where request_id = ${requestId} and command = 'knowledge.transcript.correct'`,
    );
    expect(entry?.after_json).toMatchObject({ knowledgeState: 'waiting' });
    expect(entry?.input_json).toMatchObject({ transcriptChars: expect.any(Number) as number });
    expect(JSON.stringify(entry)).not.toContain('120 meter');

    // Read again from the correction: no speech call, the passages replaced.
    const speech = fakeTranscriber(['never heard']);
    expect(await index(vault.id, { transcriber: speech })).toMatchObject({ replaced: 1 });
    expect(speech.calls).toBe(0);
    const after = await chunkTexts(vault.id);
    expect(after.join(' ')).toContain('ka head 120 meter hai');
    expect(after.join(' ')).not.toContain('galat suna');
    expect(after.join(' ')).not.toContain('6789');
  });

  it('is refused for a file that is not a recording, while it is read, in another script, or archived', async () => {
    const pdf = await add(
      gm,
      await upload(gm, { contentType: 'application/pdf', sanitising: 'masked' }),
    );
    const correct = (knowledgeFileId: string, transcript = 'Theek kiya hua') =>
      run(gm, correctKnowledgeTranscript, { entityId: 1, knowledgeFileId, transcript });
    await expect(correct(pdf.id)).rejects.toMatchObject({
      details: { reason: 'knowledge_transcript_not_audio' },
    });

    const reading = await add(gm, await upload(gm));
    await expect(correct(reading.id)).rejects.toMatchObject({
      details: { reason: 'knowledge_still_reading' },
    });

    const vault = await indexedRecording('Inverter ki battery');
    await expect(
      correct(vault.id, `Inverter ${String.fromCodePoint(0x0915, 0x0940)} battery`),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'knowledge_transcript_not_roman' },
    });
    await run(gm, archiveKnowledgeFile, { entityId: 1, knowledgeFileId: vault.id });
    await expect(correct(vault.id)).rejects.toMatchObject({
      details: { reason: 'knowledge_file_transition_not_allowed' },
    });
    expect((await fileRow(vault.id))?.transcript).toBe('Inverter ki battery');
  });

  it('refuses a correction that masking makes longer than a transcript may be', async () => {
    const vault = await indexedRecording('Tank ki safai');
    // Six characters an address, seven once masked: within the limit typed, past it once covered.
    const addresses = Array.from({ length: 14_000 }, () => 'x@b.in').join(' ');
    expect(addresses.length).toBeLessThanOrEqual(100_000);
    await expect(
      run(gm, correctKnowledgeTranscript, {
        entityId: 1,
        knowledgeFileId: vault.id,
        transcript: addresses,
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'knowledge_too_long' },
    });
    expect((await fileRow(vault.id))?.transcript).toBe('Tank ki safai');
  });

  it('lets a person type a transcript the speech service could not give', async () => {
    const vault = await add(gm, await upload(gm));
    await index(vault.id, { transcriber: undefined });
    expect(await fileRow(vault.id)).toMatchObject({ state: 'unavailable', transcript: null });
    await run(gm, correctKnowledgeTranscript, {
      entityId: 1,
      knowledgeFileId: vault.id,
      transcript: `Typed ${RUN} transcript of the site visit`,
    });
    // Read from the typed transcript without any speech service.
    await index(vault.id, { transcriber: undefined });
    expect(await fileRow(vault.id)).toMatchObject({ state: 'indexed', chunks: 1 });
  });
});

describe('a vault file’s page', () => {
  const page = (who: Principal, id: string, entityIds = [1]) =>
    executeQuery(who, { entityIds }, (ctx) => getKnowledgeFile(ctx, id), {
      name: 'test.getKnowledgeFile',
    });

  it('shows a recording’s transcript to whoever reads its sensitivity, and nothing to anyone else', async () => {
    const staff = await indexedRecording(`Valve ${RUN} ki jaanch`);
    expect(await page(caller, staff.id)).toMatchObject({
      id: staff.id,
      sourceType: 'audio',
      state: 'indexed',
      transcript: `Valve ${RUN} ki jaanch`,
      transcriptCorrectedAt: null,
    });
    const management = await add(gm, await upload(gm), { sensitivity: 'management' });
    expect(await page(caller, management.id)).toBeUndefined();
    expect(await page(gm, management.id)).toMatchObject({ transcript: null, state: 'waiting' });
    // Another company's request does not reach it.
    expect(await page(executive, staff.id, [2])).toBeUndefined();
    // A document has no transcript.
    const pdf = await add(
      gm,
      await upload(gm, { contentType: 'application/pdf', sanitising: 'masked' }),
    );
    expect(await page(gm, pdf.id)).toMatchObject({ sourceType: 'pdf', transcript: null });
  });
});
