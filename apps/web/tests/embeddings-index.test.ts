import {
  EmbeddingsIndexResult,
  ErrorEnvelope,
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type DeliveredEvent,
  type EmbeddingsIndexJob,
  type Principal,
} from '@shakti/contracts';
import { closeOutboxDb } from '@shakti/db/outbox';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import {
  addKnowledgeFile,
  createAiProvider,
  databaseAuditSink,
  databaseOutboxSink,
  fakeModelTransport,
  fakeReply,
  memoryFileStore,
  memoryKeyValue,
  memoryLogger,
  runCommand,
  sha256Hex,
  type FakeModelTransport,
} from '@shakti/domain';
import { createHash, createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { wordDocument } from '../e2e/support/docx';
import type { DocumentMasker } from '../src/workers/ocr/mask-document';
import { AADHAAR, AADHAAR_SPACED, coveringMasker, scanOf } from './support/pdf-fixtures';

// The Knowledge Vault's index worker outside a Next.js request: the route, the file checks, the
// Word reader, the commands and the database are real; the AI vendors are the fake transport and
// the file store is in memory. Every text is synthetic.
type MemoryStore = ReturnType<typeof memoryFileStore>;
interface IndexState {
  store: MemoryStore | undefined;
  /** What the model copies out of a file, and the transport the last index job used. */
  reply: string;
  transport: FakeModelTransport | undefined;
}
const state = vi.hoisted((): IndexState => ({ store: undefined, reply: '', transport: undefined }));

vi.mock('../src/workers/knowledge/index-deps', async () => {
  const { readWordText } = await import('../src/workers/knowledge/read-word');
  const { renderMaskedPages } = await import('../src/workers/files/pdf-pages');
  return {
    indexDeps: (principal: Principal, requestId: string) => {
      if (state.store === undefined) throw new Error('no store');
      const fake = fakeModelTransport([fakeReply(state.reply)]);
      state.transport = fake;
      return {
        principal,
        store: state.store,
        provider: createAiProvider({
          claude: fake,
          voyage: fake,
          keyValue: memoryKeyValue(),
          logger: memoryLogger(),
        }),
        readWord: readWordText,
        pdfPages: renderMaskedPages,
        requestId,
        hosted: false,
        logger: memoryLogger(),
      };
    },
  };
});

const { POST } = await import('../src/app/api/v1/workers/embeddings/index/route');
const { handleFileUploaded } = await import('../src/workers/files/handle-file-uploaded');
const { vaultMasker } = await import('../src/workers/ocr/vault-masker');
const { indexJobOf } = await import('../src/workers/knowledge/job');
const { EVENT_JOB_ROUTES, EMBEDDINGS_INDEX_PATH } = await import('../src/workers/qstash');

// Low-entropy phrases, so the secret scan never mistakes them for real keys (CLAUDE.md).
const CURRENT_KEY = 'index-route-test-current-signing-key';
const APP = 'http://localhost:3000';
const ROUTE = `${APP}${EMBEDDINGS_INDEX_PATH}`;
const QSTASH_ENV = [
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'BETTER_AUTH_URL',
] as const;
const saved = new Map<string, string | undefined>();
const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

let executive: Principal;
const workers = principalFor('system:workers', [1], { id: SYSTEM_WORKERS_PRINCIPAL_ID });

beforeAll(async () => {
  state.store = memoryFileStore('memory');
  executive = await createTestPrincipal('executive', [1]);
});

afterAll(async () => {
  await closeOutboxDb();
  await closeDb();
});

beforeEach(() => {
  for (const name of QSTASH_ENV) saved.set(name, process.env[name]);
  process.env.QSTASH_TOKEN = 'index-route-test-token';
  process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT_KEY;
  process.env.QSTASH_NEXT_SIGNING_KEY = 'index-route-test-next-signing-key';
  process.env.BETTER_AUTH_URL = APP;
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
});

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** A signature as QStash makes it: an HS256 token naming the address and the body's hash. */
function sign(body: string, address = ROUTE, key = CURRENT_KEY): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: 'Upstash',
      sub: address,
      iat: now,
      nbf: now,
      exp: now + 300,
      jti: newId(),
      body: createHash('sha256').update(body).digest('base64url'),
    }),
  );
  const signature = createHmac('sha256', key).update(`${header}.${claims}`).digest('base64url');
  return `${header}.${claims}.${signature}`;
}

function call(body: string, signature: string | null = sign(body)): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature !== null) headers.set('upstash-signature', signature);
  return POST(new Request(ROUTE, { method: 'POST', headers, body }));
}

/** A Word upload the executive began and finished, waiting for its checks, with its bytes. */
async function wordUpload(bytes: Buffer): Promise<string> {
  const id = newId();
  const key = `1/knowledge/${id}.docx`;
  await state.store?.put(key, bytes, WORD);
  await asMigrator(
    (
      m,
    ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
      values (${id}, 1, 'knowledge', 'memory', ${key}, 'Pump care.docx', ${WORD}, ${bytes.length},
              ${sha256Hex(bytes)}, 'scanning', ${executive.id})`,
  );
  return id;
}

/** A scanned PDF upload the executive began and finished, waiting for its checks. */
async function pdfUpload(bytes: Uint8Array): Promise<{ id: string; key: string }> {
  const id = newId();
  const key = `1/knowledge/${id}.pdf`;
  await state.store?.put(key, bytes, 'application/pdf');
  await asMigrator(
    (
      m,
    ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
      values (${id}, 1, 'knowledge', 'memory', ${key}, 'KYC sheet.pdf', 'application/pdf', ${bytes.length},
              ${sha256Hex(bytes)}, 'scanning', ${executive.id})`,
  );
  return { id, key };
}

/** The file checks of an upload, as the event worker runs them. */
function checks(fileId: string, masker?: () => Promise<DocumentMasker>) {
  const event: DeliveredEvent = {
    id: newId(),
    sequence: '1',
    type: 'files.file.uploaded',
    entityId: 1,
    aggregateType: 'file',
    aggregateId: fileId,
    payload: { purpose: 'knowledge', v: 1 },
  };
  if (state.store === undefined) throw new Error('no store');
  return handleFileUploaded(event, {
    store: state.store,
    principal: workers,
    hosted: false,
    ...(masker === undefined ? {} : { masker }),
  });
}

/** The index event the vault sent for a vault file, as the outbox would deliver it. */
async function indexEvent(knowledgeFileId: string): Promise<DeliveredEvent> {
  const [row] = await asOutboxPublisher(
    (p) => p<{ id: string; sequence: string; entity_id: number; payload_json: unknown }[]>`
      select id, sequence::text, entity_id, payload_json from outbox_events
       where aggregate_id = ${knowledgeFileId} and type = 'knowledge.file.index_requested'`,
  );
  if (row === undefined) throw new Error('no index event');
  return {
    id: row.id,
    sequence: row.sequence,
    type: 'knowledge.file.index_requested',
    entityId: row.entity_id,
    aggregateType: 'knowledge_file',
    aggregateId: knowledgeFileId,
    payload: row.payload_json as DeliveredEvent['payload'],
  };
}

describe('POST /api/v1/workers/embeddings/index', () => {
  it('is where the outbox sends an index event, as the job it stands for', () => {
    expect(EVENT_JOB_ROUTES['knowledge.file.index_requested']?.path).toBe(EMBEDDINGS_INDEX_PATH);
  });

  it.each([
    ['no signature', null],
    ['a signature made with another key', 'key'],
    ['a signature for another address', 'address'],
  ])('refuses a call with %s', async (_label, kind) => {
    const job: EmbeddingsIndexJob = {
      eventId: newId(),
      knowledgeFileId: newId(),
      entityId: 1,
      fileEntityId: 1,
      sensitivity: 'staff_ai_ok',
    };
    const body = JSON.stringify(job);
    const signature =
      kind === null
        ? null
        : kind === 'key'
          ? sign(body, ROUTE, 'some-other-signing-key')
          : sign(body, `${APP}/api/v1/workers/pdf/render`);
    const response = await call(body, signature);
    expect(response.status).toBe(401);
    expect(ErrorEnvelope.parse(await response.json()).error.code).toBe('unauthorized');
  });

  it('refuses a body that is not a job, for good', async () => {
    const response = await call(JSON.stringify({ eventId: newId() }));
    expect(response.status).toBe(400);
    expect(response.headers.get('upstash-nonretryable-error')).toBe('true');
  });

  it('checks a Word upload, reads it once its vault file is added, and answers a repeat as a duplicate', async () => {
    const bytes = wordDocument([
      'Solar pump care',
      'Clean the panels every fortnight with plain water.',
      'Call the service desk before opening the controller.',
    ]);
    const fileId = await wordUpload(bytes);
    expect(await checks(fileId)).toEqual({ status: 'ready' });
    const [checked] = await asMigrator(
      (m) => m<{ status: string; sanitising: string }[]>`
        select status, scan_result->>'sanitising' as sanitising from files where id = ${fileId}`,
    );
    expect(checked).toEqual({ status: 'ready', sanitising: 'document_checked' });

    const vault = await asPrincipal(executive, (context) =>
      runCommand(
        addKnowledgeFile,
        { context, audit: databaseAuditSink, outbox: databaseOutboxSink },
        { entityId: 1, fileId, title: 'Solar pump care', sensitivity: 'staff_ai_ok' },
      ),
    );
    const job = indexJobOf(await indexEvent(vault.id));
    expect(job).toMatchObject({ knowledgeFileId: vault.id, entityId: 1, fileEntityId: 1 });

    const body = JSON.stringify(job);
    const response = await call(body);
    expect(response.status).toBe(200);
    const result = EmbeddingsIndexResult.parse(await response.json());
    expect(result).toMatchObject({ outcome: 'done', knowledgeFileId: vault.id, replaced: 0 });
    const [chunk] = await asMigrator(
      (m) => m<{ chunk_text: string }[]>`
        select chunk_text from knowledge_chunks where knowledge_file_id = ${vault.id}`,
    );
    expect(chunk?.chunk_text).toContain('Clean the panels every fortnight');

    const again = await call(body);
    expect(EmbeddingsIndexResult.parse(await again.json())).toMatchObject({
      outcome: 'duplicate',
    });
  });

  // The real masking step needs the English OCR model (`OCR_LANG_PATH`); without the folder the
  // stand-in step covers a corner, which proves the plumbing but not the OCR itself.
  const realOcr = (process.env.OCR_LANG_PATH ?? '') !== '';

  it('masks a scanned PDF page by page before it is kept, and shows the model only the masked pages', async () => {
    const original = await scanOf(`Aadhaar No ${AADHAAR_SPACED}`);
    const { id: fileId, key } = await pdfUpload(original);
    const masker = realOcr ? vaultMasker : () => Promise.resolve(coveringMasker());
    expect(await checks(fileId, masker)).toEqual({ status: 'ready' });

    // The original PDF is gone from the store; what is kept is the masked rendition.
    const [kept] = await asMigrator(
      (m) => m<{ key: string; sanitising: string; regions: number }[]>`
        select key, scan_result->>'sanitising' as sanitising,
               (scan_result->>'regionsMasked')::int as regions from files where id = ${fileId}`,
    );
    expect(kept?.sanitising).toBe('masked');
    expect(kept?.regions).toBeGreaterThan(0);
    expect(kept?.key).not.toBe(key);
    expect(state.store?.objects.has(key)).toBe(false);
    const stored = state.store?.objects.get(kept?.key ?? '');
    expect(
      Buffer.from(stored?.bytes ?? [])
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');

    const vault = await asPrincipal(executive, (context) =>
      runCommand(
        addKnowledgeFile,
        { context, audit: databaseAuditSink, outbox: databaseOutboxSink },
        { entityId: 1, fileId, title: 'KYC sheet', sensitivity: 'staff_ai_ok' },
      ),
    );
    state.reply = `Pump warranty is five years. Call 9876543210 for service. Aadhaar ${AADHAAR_SPACED}.`;
    const response = await call(JSON.stringify(indexJobOf(await indexEvent(vault.id))));
    expect(response.status).toBe(200);

    // Everything the model was sent: pictures of the masked pages only, no PDF, no number.
    const sent = state.transport?.requests ?? [];
    expect(sent).toHaveLength(1);
    const documents = sent[0]?.documents ?? [];
    expect(documents.length).toBeGreaterThan(0);
    for (const document of documents) {
      expect(document.mediaType).toBe('image/jpeg');
      expect(Buffer.from(document.bytes).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    }
    const payload = JSON.stringify(sent[0]);
    expect(payload).not.toContain('%PDF');
    expect(payload).not.toContain(AADHAAR);
    expect(payload).not.toContain(AADHAAR_SPACED);

    // What the model wrote back is masked again before it is stored or embedded.
    const chunks = await asMigrator(
      (m) => m<{ chunk_text: string }[]>`
        select chunk_text from knowledge_chunks where knowledge_file_id = ${vault.id}`,
    );
    const text = chunks.map((c) => c.chunk_text).join('\n');
    expect(text).toContain('Pump warranty is five years');
    expect(text).not.toContain('9876543210');
    expect(text).not.toContain(AADHAAR_SPACED);
    expect(state.transport?.embeddings.flatMap((e) => e.texts).join(' ')).not.toContain('6789');
    state.reply = '';
  }, 120_000);

  it('refuses a vault PDF of too many pages with a plain reason, and keeps nothing', async () => {
    const { pdfOf } = await import('./support/pdf-fixtures');
    const many = await pdfOf(Array.from({ length: 13 }, (_, i) => `Page ${String(i)}`));
    const { id: fileId, key } = await pdfUpload(many);
    expect(await checks(fileId, () => Promise.resolve(coveringMasker()))).toEqual({
      status: 'rejected',
    });
    const [row] = await asMigrator(
      (m) => m<{ reason: string }[]>`
        select scan_result->>'rejectReason' as reason from files where id = ${fileId}`,
    );
    expect(row?.reason).toBe('file_pdf_too_many_pages');
    expect(state.store?.objects.has(key)).toBe(false);
  });

  it('refuses a vault PDF at once when no masking step is set up, and the vault file says so', async () => {
    const { pdfOf } = await import('./support/pdf-fixtures');
    const { id: fileId, key } = await pdfUpload(await pdfOf(['One page']));
    const vault = await asPrincipal(executive, (context) =>
      runCommand(
        addKnowledgeFile,
        { context, audit: databaseAuditSink, outbox: databaseOutboxSink },
        { entityId: 1, fileId, title: 'Scheme circular', sensitivity: 'staff_ai_ok' },
      ),
    );
    // No masker is given, as on a runtime where `OCR_LANG_PATH` is not set.
    expect(await checks(fileId)).toEqual({ status: 'rejected' });
    const [upload] = await asMigrator(
      (m) => m<{ reason: string }[]>`
        select scan_result->>'rejectReason' as reason from files where id = ${fileId}`,
    );
    expect(upload?.reason).toBe('file_masking_unavailable');
    expect(state.store?.objects.has(key)).toBe(false);
    const [file] = await asMigrator(
      (m) => m<{ state: string; error_reason: string }[]>`
        select state, error_reason from knowledge_files where id = ${vault.id}`,
    );
    expect(file).toEqual({ state: 'failed', error_reason: 'knowledge_masking_unavailable' });
  });

  it('refuses a Word upload that is not one, and a job for a vault file that is not there', async () => {
    const fileId = await wordUpload(Buffer.from('this is plain text, not a Word file'));
    expect(await checks(fileId)).toEqual({ status: 'rejected' });

    const job: EmbeddingsIndexJob = {
      eventId: newId(),
      knowledgeFileId: newId(),
      entityId: 1,
      fileEntityId: 1,
      sensitivity: 'staff_ai_ok',
    };
    const response = await call(JSON.stringify(job));
    expect(response.status).toBe(404);
    expect(response.headers.get('upstash-nonretryable-error')).toBe('true');
  });
});
