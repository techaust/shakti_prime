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
  principalFor,
} from '@shakti/db/testing';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAiProvider, type AiProvider } from '../../src/ai/provider';
import { fakeEmbedding, fakeModelTransport, fakeReply } from '../../src/ai/transport';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { executeQuery } from '../../src/command/execute';
import { runCommand } from '../../src/command/run-command';
import { markFileReady, rejectFile } from '../../src/commands/files/check-file';
import {
  addKnowledgeFile,
  archiveKnowledgeFile,
  reindexKnowledgeFile,
} from '../../src/commands/knowledge/files';
import { recordKnowledgeIndex } from '../../src/commands/knowledge/record-index';
import { indexKnowledgeFile } from '../../src/knowledge/index-file';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { memoryFileStore, sha256Hex } from '../../src/ports/file-store';
import { memoryKeyValue } from '../../src/ports/key-value';
import { memoryLogger } from '../../src/ports/logger';
import { listKnowledgeFiles, searchKnowledge } from '../../src/queries/knowledge/vault';

// The Knowledge Vault's commands, index job and search on real Postgres (docs/design/phase1.md
// §8.4). Every model call goes to the fake transport; every text is synthetic.

afterAll(closeDb);

/** A word no earlier run wrote, so this run's passages rank first in its own searches. */
const RUN = `run${Date.now().toString(36)}`;

const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const WORKBOOK = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let executive: Principal;
let gm: Principal;
let caller: Principal;
const store = memoryFileStore('memory');

/** The worker principal of the index job, acting in one company. */
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

const run = (principal: Principal, command: Parameters<typeof runCommand>[0], input: unknown) =>
  asPrincipal(principal, (context) => runCommand(command, { context, audit, outbox }, input));

/** A vault upload of `uploader`, stored with its bytes, in the given status. */
async function upload(
  uploader: Principal,
  options: { entityId?: number; status?: string; bytes?: Uint8Array; contentType?: string } = {},
): Promise<string> {
  const id = newId();
  const entityId = options.entityId ?? 1;
  const bytes = options.bytes ?? new TextEncoder().encode('%PDF-1.7 vault test');
  const contentType = options.contentType ?? 'application/pdf';
  const key = `${String(entityId)}/knowledge/${id}.bin`;
  await store.put(key, bytes, contentType);
  await asMigrator(
    (m) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
      values (${id}, ${entityId}, 'knowledge', ${store.bucket}, ${key}, 'vault file', ${contentType},
              ${bytes.length}, ${sha256Hex(bytes)}, ${options.status ?? 'ready'}, ${uploader.id})`,
  );
  return id;
}

const add = (
  principal: Principal,
  fileId: string,
  over: { sensitivity?: KnowledgeSensitivity; wholeGroup?: boolean; entityId?: number } = {},
) =>
  run(principal, addKnowledgeFile, {
    entityId: over.entityId ?? 1,
    fileId,
    title: 'Pump care guide',
    sensitivity: over.sensitivity ?? 'staff_ai_ok',
    wholeGroup: over.wholeGroup ?? false,
  });

async function indexEvents(knowledgeFileId: string) {
  return asOutboxPublisher(
    (p) => p<{ type: string; entity_id: number; payload_json: unknown }[]>`
      select type, entity_id, payload_json from outbox_events where aggregate_id = ${knowledgeFileId}`,
  );
}

async function stateOf(id: string) {
  const [row] = await asMigrator(
    (m) => m<{ state: string; chunks: number; error_reason: string | null }[]>`
      select state, chunks, error_reason from knowledge_files where id = ${id}`,
  );
  return row;
}

function provider(options: { claude?: boolean; voyage?: boolean; reply?: string } = {}) {
  const transport = fakeModelTransport([fakeReply(options.reply ?? '')]);
  return {
    transport,
    provider: createAiProvider({
      claude: options.claude === false ? undefined : transport,
      voyage: options.voyage === false ? undefined : transport,
      keyValue: memoryKeyValue(),
      logger: memoryLogger(),
    }),
  };
}

function job(knowledgeFileId: string, fileEntityId = 1, entityId: number | null = 1): EmbeddingsIndexJob {
  return { eventId: newId(), knowledgeFileId, entityId, fileEntityId, sensitivity: 'staff_ai_ok' };
}

const index = (
  knowledgeFileId: string,
  ai: AiProvider,
  readWord: (bytes: Uint8Array) => Promise<string> = () => Promise.resolve(''),
  fileEntityId = 1,
) =>
  indexKnowledgeFile(job(knowledgeFileId, fileEntityId), {
    principal: workers(fileEntityId),
    store,
    provider: ai,
    readWord,
    requestId: newId(),
    hosted: false,
    logger: memoryLogger(),
  });

describe('knowledge.file.add', () => {
  it('is refused without knowledge.vault.write, and to every agent', async () => {
    const fileId = await upload(executive);
    await expect(add(caller, fileId)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(add(principalFor('agent:copilot', [1]), fileId)).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'people_only' },
    });
  });

  it('is refused for a company outside the request, or an upload of another company', async () => {
    await expect(add(gm, await upload(gm), { entityId: 2 })).rejects.toMatchObject({
      code: 'forbidden',
    });
    const elsewhere = await upload(executive, { entityId: 2 });
    await expect(add(executive, elsewhere)).rejects.toMatchObject({
      code: 'not_found',
      details: { reason: 'file_missing' },
    });
    // Someone else's upload is not the caller's to add.
    await expect(add(gm, await upload(executive))).rejects.toMatchObject({ code: 'not_found' });
  });

  it('takes only a sensitivity the caller reads, and the whole group only from every company', async () => {
    await expect(add(gm, await upload(gm), { sensitivity: 'exec_only' })).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'knowledge_sensitivity_not_held' },
    });
    await expect(add(gm, await upload(gm), { wholeGroup: true })).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'knowledge_needs_all_companies' },
    });
    const whole = await add(executive, await upload(executive), { wholeGroup: true });
    expect(whole).toMatchObject({ entityId: null, state: 'waiting' });
  });

  it('adds a checked upload and sends it to be indexed; an upload still checked waits', async () => {
    const ready = await add(gm, await upload(gm), { sensitivity: 'management' });
    expect(ready).toMatchObject({
      entityId: 1,
      sensitivity: 'management',
      sourceType: 'pdf',
      state: 'waiting',
      chunks: 0,
    });
    expect(await indexEvents(ready.id)).toEqual([
      {
        type: 'knowledge.file.index_requested',
        entity_id: 1,
        payload_json: { knowledgeEntityId: 1, sensitivity: 'management', v: 1 },
      },
    ]);
    const scanning = await add(gm, await upload(gm, { status: 'scanning' }));
    expect(await indexEvents(scanning.id)).toEqual([]);
    await expect(add(gm, await upload(gm, { status: 'pending' }))).rejects.toMatchObject({
      details: { reason: 'knowledge_upload_unfinished' },
    });
    await expect(add(gm, await upload(gm, { status: 'rejected' }))).rejects.toMatchObject({
      details: { reason: 'knowledge_upload_rejected' },
    });
  });

  it('adds an upload once', async () => {
    const fileId = await upload(gm);
    await add(gm, fileId);
    await expect(add(gm, fileId)).rejects.toMatchObject({
      details: { reason: 'knowledge_file_taken' },
    });
  });
});

describe('the upload’s checks and the vault', () => {
  it('sends a waiting vault file to be indexed once its upload passes, and fails it when refused', async () => {
    const passing = await upload(gm, { status: 'scanned' });
    const waiting = await add(gm, passing);
    await run(workers(1), markFileReady, {
      entityId: 1,
      fileId: passing,
      sanitising: 'pdf_checked',
      stored: { key: `1/knowledge/${passing}.bin`, contentType: 'application/pdf', size: 19, sha256: 'b'.repeat(64) },
    });
    expect((await indexEvents(waiting.id)).map((e) => e.type)).toEqual([
      'knowledge.file.index_requested',
    ]);

    const refused = await upload(gm, { status: 'scanned' });
    const doomed = await add(gm, refused);
    await run(workers(1), rejectFile, { entityId: 1, fileId: refused, reason: 'file_infected' });
    expect(await stateOf(doomed.id)).toEqual({
      state: 'failed',
      chunks: 0,
      error_reason: 'knowledge_file_rejected',
    });
  });
});

describe('the index job', () => {
  it('reads a workbook sheet by sheet, and the passages are found by search', async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Pumps').addRows([
      ['Model', 'Head'],
      [`Borewell submersible ${RUN}`, '120 m'],
    ]);
    book.addWorksheet('Panels').addRows([['Module', 'Watts'], ['Mono perc panel', '540']]);
    const bytes = new Uint8Array(await book.xlsx.writeBuffer());
    const vault = await add(gm, await upload(gm, { bytes, contentType: WORKBOOK }));
    expect(vault.sourceType).toBe('excel');
    const { provider: ai, transport } = provider();
    const indexed = await index(vault.id, ai);
    expect(indexed).toMatchObject({ knowledgeFileId: vault.id, chunks: 1, replaced: 0 });
    expect(transport.embeddings[0]?.inputType).toBe('document');
    expect(transport.embeddings[0]?.texts[0]).toContain('Model | Head');
    expect(transport.embeddings[0]?.texts[0]).toContain('Module | Watts');
    expect(transport.requests).toHaveLength(0);
    expect(await stateOf(vault.id)).toMatchObject({ state: 'indexed', chunks: 1 });

    const hits = await executeQuery(
      caller,
      { entityIds: [1] },
      (ctx) => searchKnowledge(ctx, fakeEmbedding(`borewell submersible ${RUN}`)),
      { name: 'test.searchKnowledge' },
    );
    // The file is management knowledge only when tagged so; this one is staff knowledge.
    expect(hits.some((h) => h.knowledgeFileId === vault.id)).toBe(true);
    expect(hits.find((h) => h.knowledgeFileId === vault.id)?.title).toBe('Pump care guide');
  });

  it('reads a Word document with the reader it is given, and masks numbers before storing', async () => {
    const vault = await add(gm, await upload(gm, { contentType: WORD }));
    const { provider: ai } = provider();
    await index(vault.id, ai, () =>
      Promise.resolve('Service desk\n\nCall 9876543210 for pump service in Jaipur.'),
    );
    const [chunk] = await asMigrator(
      (m) => m<{ chunk_text: string }[]>`
        select chunk_text from knowledge_chunks where knowledge_file_id = ${vault.id}`,
    );
    expect(chunk?.chunk_text).toContain('[phone]');
    expect(chunk?.chunk_text).not.toContain('9876543210');
  });

  it('reads a PDF through the model and replaces the passages when read again', async () => {
    const vault = await add(gm, await upload(gm));
    const first = provider({ reply: 'Warranty covers the motor for five years.' });
    expect(await index(vault.id, first.provider)).toMatchObject({ chunks: 1, replaced: 0 });
    expect(first.transport.requests[0]?.documents?.[0]?.mediaType).toBe('application/pdf');
    // A repeated delivery finds the file indexed and changes nothing.
    expect(await index(vault.id, first.provider)).toMatchObject({ chunks: 1, replaced: 0 });
    expect(first.transport.requests).toHaveLength(1);

    const again = await run(gm, reindexKnowledgeFile, { entityId: 1, knowledgeFileId: vault.id });
    expect(again.state).toBe('waiting');
    const second = provider({ reply: 'Warranty covers the motor.\n\nPanels are covered for ten years.' });
    expect(await index(vault.id, second.provider)).toMatchObject({ chunks: 1, replaced: 1 });
  });

  it('records a file unavailable without a key, failed with no text, and waits for its checks', async () => {
    const noKey = await add(gm, await upload(gm));
    expect(await index(noKey.id, provider({ claude: false }).provider)).toMatchObject({ chunks: 0 });
    expect(await stateOf(noKey.id)).toEqual({
      state: 'unavailable',
      chunks: 0,
      error_reason: 'knowledge_service_missing',
    });
    // Once the key is set, an Executive or GM reads it again.
    await run(gm, reindexKnowledgeFile, { entityId: 1, knowledgeFileId: noKey.id });
    expect(await stateOf(noKey.id)).toMatchObject({ state: 'waiting', error_reason: null });

    const empty = await add(gm, await upload(gm, { contentType: WORD }));
    await index(empty.id, provider().provider, () => Promise.resolve('  \n '));
    expect(await stateOf(empty.id)).toMatchObject({
      state: 'failed',
      error_reason: 'knowledge_empty',
    });

    const unchecked = await add(gm, await upload(gm, { status: 'scanning' }));
    expect(await index(unchecked.id, provider().provider)).toMatchObject({ chunks: 0, replaced: 0 });
    expect(await stateOf(unchecked.id)).toMatchObject({ state: 'waiting' });
  });

  it('runs only as the worker principal of the upload’s company', async () => {
    const vault = await add(gm, await upload(gm));
    await expect(
      indexKnowledgeFile(job(vault.id), {
        principal: executive,
        store,
        provider: provider().provider,
        readWord: () => Promise.resolve(''),
        requestId: newId(),
        hosted: false,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(index(vault.id, provider().provider, undefined, 2)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('knowledge.file.record_index is the workers’ alone', async () => {
    const vault = await add(gm, await upload(gm));
    const input = {
      entityId: 1,
      knowledgeFileId: vault.id,
      outcome: 'failed',
      reason: 'knowledge_unreadable',
    };
    await expect(run(executive, recordKnowledgeIndex, input)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(run(workers(2), recordKnowledgeIndex, { ...input, entityId: 2 })).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await run(workers(1), recordKnowledgeIndex, input)).toMatchObject({
      state: 'failed',
      skipped: false,
    });
    expect(await run(workers(1), recordKnowledgeIndex, input)).toMatchObject({ skipped: true });
  });
});

describe('knowledge.file.reindex and knowledge.file.archive', () => {
  it('are refused without the write and in another company', async () => {
    const vault = await add(gm, await upload(gm));
    await expect(
      run(caller, archiveKnowledgeFile, { entityId: 1, knowledgeFileId: vault.id }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const gmOfTwo = await createTestPrincipal('general_manager', [2]);
    await expect(
      run(gmOfTwo, archiveKnowledgeFile, { entityId: 2, knowledgeFileId: vault.id }),
    ).rejects.toMatchObject({ code: 'not_found' });
    // A waiting file is not read again before it is read.
    await expect(
      run(gm, reindexKnowledgeFile, { entityId: 1, knowledgeFileId: vault.id }),
    ).rejects.toMatchObject({ details: { reason: 'knowledge_file_transition_not_allowed' } });
  });

  it('archives a file, which leaves search and the list', async () => {
    const vault = await add(gm, await upload(gm, { contentType: WORD }));
    await index(vault.id, provider().provider, () => Promise.resolve('Drip irrigation kit notes'));
    const archived = await run(gm, archiveKnowledgeFile, { entityId: 1, knowledgeFileId: vault.id });
    expect(archived).toMatchObject({ state: 'archived', chunks: 0 });
    const left = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from knowledge_chunks where knowledge_file_id = ${vault.id}`,
    );
    expect(left[0]?.n).toBe(0);
    const page = await executeQuery(gm, { entityIds: [1] }, (ctx) => listKnowledgeFiles(ctx, {}), {
      name: 'test.listKnowledgeFiles',
    });
    expect(page.files.some((f) => f.id === vault.id)).toBe(false);
    await expect(
      run(gm, reindexKnowledgeFile, { entityId: 1, knowledgeFileId: vault.id }),
    ).rejects.toMatchObject({ details: { reason: 'knowledge_file_transition_not_allowed' } });
  });
});

describe('the vault list and the search', () => {
  it('show a reader only the sensitivities they hold', async () => {
    const managementOnly = await add(gm, await upload(gm, { contentType: WORD }), {
      sensitivity: 'management',
    });
    await index(managementOnly.id, provider().provider, () =>
      Promise.resolve(`Quarterly dealer margin review ${RUN}`),
    );
    const listed = async (who: Principal) =>
      (
        await executeQuery(who, { entityIds: [1] }, (ctx) => listKnowledgeFiles(ctx, {}), {
          name: 'test.listKnowledgeFiles',
        })
      ).files.some((f) => f.id === managementOnly.id);
    expect(await listed(gm)).toBe(true);
    expect(await listed(caller)).toBe(false);
    const found = async (who: Principal) =>
      (
        await executeQuery(
          who,
          { entityIds: [1] },
          (ctx) => searchKnowledge(ctx, fakeEmbedding(`quarterly dealer margin review ${RUN}`)),
          { name: 'test.searchKnowledge' },
        )
      ).some((h) => h.knowledgeFileId === managementOnly.id);
    expect(await found(gm)).toBe(true);
    expect(await found(caller)).toBe(false);
  });

  it('pages the list newest first', async () => {
    const page = await executeQuery(
      executive,
      { entityIds: [1] },
      (ctx) => listKnowledgeFiles(ctx, {}),
      { name: 'test.listKnowledgeFiles' },
    );
    const times = page.files.map((f) => f.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });
});
