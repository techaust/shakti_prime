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
  memoryFileStore,
  memoryKeyValue,
  memoryLogger,
  runCommand,
  sha256Hex,
  type FileStore,
} from '@shakti/domain';
import { createHash, createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { wordDocument } from '../e2e/support/docx';

// The Knowledge Vault's index worker outside a Next.js request: the route, the file checks, the
// Word reader, the commands and the database are real; the AI vendors are the fake transport and
// the file store is in memory. Every text is synthetic.
interface IndexState {
  store: FileStore | undefined;
}
const state = vi.hoisted((): IndexState => ({ store: undefined }));

vi.mock('../src/workers/knowledge/index-deps', async () => {
  const { readWordText } = await import('../src/workers/knowledge/read-word');
  return {
    indexDeps: (principal: Principal, requestId: string) => {
      if (state.store === undefined) throw new Error('no store');
      const fake = fakeModelTransport();
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
        requestId,
        hosted: false,
        logger: memoryLogger(),
      };
    },
  };
});

const { POST } = await import('../src/app/api/v1/workers/embeddings/index/route');
const { handleFileUploaded } = await import('../src/workers/files/handle-file-uploaded');
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
    (m) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
      values (${id}, 1, 'knowledge', 'memory', ${key}, 'Pump care.docx', ${WORD}, ${bytes.length},
              ${sha256Hex(bytes)}, 'scanning', ${executive.id})`,
  );
  return id;
}

/** The file checks of an upload, as the event worker runs them. */
function checks(fileId: string) {
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
  return handleFileUploaded(event, { store: state.store, principal: workers, hosted: false });
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
