import {
  ErrorEnvelope,
  IMPORT_LIMITS,
  ImportCommitWorkerResponse,
  newId,
  type ImportJobDto,
  type Principal,
} from '@shakti/contracts';
import { closeOutboxDb } from '@shakti/db/outbox';
import { asMigrator, closeDb, createTestUser, principalFor } from '@shakti/db/testing';
import {
  commitImportJob as commitImportJobCommand,
  executeCommand,
  memoryFileStore,
  type FileStore,
} from '@shakti/domain';
import { createHash, createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The import actions and worker outside a Next.js request, as in `actions.test.ts`: the request
// headers, the signed-in caller, the file store and the queue client are stand-ins; the commands,
// the parser and the database are real.
interface RequestState {
  principal: Principal | undefined;
  headers: Headers;
  store: FileStore | undefined;
  published: unknown[];
}

const request = vi.hoisted((): RequestState => ({
  principal: undefined,
  headers: new Headers(),
  store: undefined,
  published: [],
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(request.headers),
  cookies: () => Promise.resolve({ get: () => undefined, set: () => undefined }),
}));

vi.mock('../src/auth/current-principal', () => ({
  currentPrincipal: () => Promise.resolve(request.principal),
}));

vi.mock('../src/files/store', () => ({ fileStore: () => request.store }));

// Signatures are checked by the real receiver; nothing is ever sent to the queue.
vi.mock('@upstash/qstash', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  Client: class {
    publishJSON(message: unknown) {
      request.published.push(message);
      return Promise.resolve({ messageId: 'test-message' });
    }
    batchJSON(messages: unknown[]) {
      return Promise.resolve(messages.map(() => ({ messageId: 'test-message' })));
    }
  },
}));

const {
  commitImportJob,
  getImportJob,
  listImportJobs,
  listImportTemplates,
  listImportRows,
  mapImportJob,
  previewImportJob,
  rollbackImportJob,
  uploadImportFile,
} = await import('../src/actions/imports');
const { POST } = await import('../src/app/api/v1/workers/imports/commit/route');
const { importRunId, scheduleImportCommit } = await import('../src/workers/imports');

let files: ReturnType<typeof memoryFileStore>;
let gm: Principal;

beforeAll(async () => {
  // A General Manager of Shakti Supreme with an authenticator app, as the worker resolves them.
  const user = await createTestUser([{ entityId: 1, roleKey: 'general_manager' }], {
    twoFactorEnabled: true,
  });
  gm = principalFor('general_manager', [1], { id: user.id });
});
afterAll(async () => {
  await closeOutboxDb();
  await closeDb();
});
beforeEach(() => {
  files = memoryFileStore();
  request.store = files;
  request.principal = gm;
  request.headers = new Headers();
  request.published.length = 0;
});

/** A mobile number no earlier run used, so the rows never meet an earlier customer. */
function phone(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

function uploadForm(content: BlobPart, name = 'fair-leads.csv', kind = 'leads'): FormData {
  const form = new FormData();
  form.set('entityId', '1');
  form.set('kind', kind);
  form.set('file', new File([content], name));
  return form;
}

function keyOf(csv: string): string {
  return `imports/1/${createHash('sha256').update(csv).digest('hex')}.csv`;
}

/** How many file records the first company holds for this content. */
async function filesRecorded(csv: string): Promise<number> {
  const sha256 = createHash('sha256').update(csv).digest('hex');
  const [row] = await asMigrator(
    (m) => m<{ n: number }[]>`select count(*)::int as n from files
     where entity_id = 1 and sha256 = ${sha256}`,
  );
  return row?.n ?? -1;
}

function ok<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`the action failed with ${result.error}`);
  return result.data;
}

const mapping = {
  columns: { contactName: 'Name', phone: 'Mobile', village: 'Village' },
  defaults: { pipelineKey: 'farmer_pumps', accountType: 'farm', siteType: 'borewell' },
};

/** Uploads a CSV of the given names and takes it through mapping and preview. */
async function previewedJob(names: string[]): Promise<ImportJobDto> {
  const csv = `Name,Mobile,Village\n${names.map((n) => `${n},${phone()},Jhunjhunu`).join('\n')}\n`;
  const job = ok(await uploadImportFile(uploadForm(csv)));
  ok(await mapImportJob({ entityId: 1, jobId: job.id, mapping }));
  return ok(await previewImportJob({ entityId: 1, jobId: job.id }));
}

async function liveLeads(jobId: string): Promise<number> {
  const [row] = await asMigrator(
    (m) => m<{ n: number }[]>`select count(*)::int as n from opportunities o
      join import_rows r on r.created_id = o.id
     where r.job_id = ${jobId} and o.archived_at is null`,
  );
  return row?.n ?? -1;
}

describe('the upload action', () => {
  it('refuses a file over the limit before reading it', async () => {
    const big = new Uint8Array(IMPORT_LIMITS.maxFileBytes + 1).fill(0x41);
    expect(await uploadImportFile(uploadForm(big))).toEqual({
      ok: false,
      error: 'import_file_too_large',
    });
    expect(files.objects.size).toBe(0);
  });

  it('refuses a file that is not a CSV or an Excel workbook', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
    expect(await uploadImportFile(uploadForm(png, 'photo.csv'))).toEqual({
      ok: false,
      error: 'import_file_type',
    });
    expect(files.objects.size).toBe(0);
  });

  it('refuses someone who may not import, before reading the file', async () => {
    request.principal = principalFor('tele_caller_cc', [1]);
    const result = await uploadImportFile(uploadForm(`Name,Mobile\nRam,${phone()}\n`));
    expect(result).toEqual({ ok: false, error: 'forbidden' });
    expect(files.objects.size).toBe(0);
  });

  it('stores the file under its content, then records the job and its rows', async () => {
    const csv = `Name,Mobile,Village\nGopal,${phone()},Churu\nMeera,${phone()},\n`;
    const job = ok(await uploadImportFile(uploadForm(csv), newId()));
    expect(job).toMatchObject({
      state: 'uploaded',
      kind: 'leads',
      format: 'csv',
      totalRows: 2,
      file: { name: 'fair-leads.csv' },
    });
    expect(files.objects.get(keyOf(csv))?.contentType).toBe('text/csv');
  });

  it('keeps the stored copy when the command refuses the file, and the next upload reuses it', async () => {
    const csv = `Name,Mobile\nKishan,${phone()}\n`;
    // Items cannot be imported yet: the command refuses after the file was read and stored.
    const result = await uploadImportFile(uploadForm(csv, 'items.csv', 'items'));
    expect(result).toMatchObject({ ok: false, error: 'validation_failed' });
    expect(await filesRecorded(csv)).toBe(0);
    expect([...files.objects.keys()]).toEqual([keyOf(csv)]);

    // The same file as leads: the bytes already there are the bytes of this file.
    ok(await uploadImportFile(uploadForm(csv)));
    expect(await filesRecorded(csv)).toBe(1);
    expect([...files.objects.keys()]).toEqual([keyOf(csv)]);
  });

  it('records nothing when the file cannot be saved, so the same file can be tried again', async () => {
    const csv = `Name,Mobile\nSundar,${phone()}\n`;
    request.store = {
      bucket: 'memory',
      put: () => Promise.reject(new Error('the disk is full')),
      get: () => Promise.resolve(undefined),
    };
    const failed = await uploadImportFile(uploadForm(csv), newId());
    expect(failed).toMatchObject({ ok: false, error: 'import_store_failed' });
    expect(failed.ok ? undefined : failed.reference).toEqual(expect.any(String));
    expect(await filesRecorded(csv)).toBe(0);

    // Once the store keeps files again, the same file is added rather than refused as a repeat.
    request.store = files;
    expect(ok(await uploadImportFile(uploadForm(csv), newId()))).toMatchObject({
      state: 'uploaded',
      totalRows: 1,
    });
    expect(await filesRecorded(csv)).toBe(1);
    expect(files.objects.get(keyOf(csv))?.contentType).toBe('text/csv');
  });

  it('refuses the same file a second time and keeps the first copy', async () => {
    const csv = `Name,Mobile\nHari,${phone()}\n`;
    ok(await uploadImportFile(uploadForm(csv)));
    expect(await uploadImportFile(uploadForm(csv))).toEqual({
      ok: false,
      error: 'import_file_duplicate',
    });
    expect([...files.objects.keys()]).toEqual([keyOf(csv)]);
  });

  it('answers a plain sentence where no file store exists yet', async () => {
    request.store = undefined;
    const result = await uploadImportFile(uploadForm(`Name,Mobile\nRam,${phone()}\n`));
    expect(result).toMatchObject({ ok: false, error: 'import_store_unavailable' });
  });
});

describe('the list of imports', () => {
  it('shows the new job among the newest, with the name of the person who started it', async () => {
    const job = ok(
      await uploadImportFile(
        uploadForm(`Name,Mobile
Lakshmi,${phone()}
`),
      ),
    );
    const page = ok(await listImportJobs({ entityId: 1, limit: 5 }));
    // Other suites add jobs to this company at the same time, so the newest few are searched.
    expect(page.items.some((j) => j.id === job.id)).toBe(true);
    expect(page.creators[gm.id]).toBeTruthy();
    // Without a company, every company being viewed; this caller views only the first.
    const all = ok(await listImportJobs({}));
    expect(all.items.some((j) => j.id === job.id)).toBe(true);
  });

  it('refuses someone who may not import, and a company outside their view', async () => {
    expect(await listImportJobs({ entityId: 2 })).toEqual({ ok: false, error: 'forbidden' });
    request.principal = principalFor('tele_caller_cc', [1]);
    expect(await listImportJobs({ entityId: 1 })).toEqual({ ok: false, error: 'forbidden' });
  });

  it('answers the rows of a previewed job with their findings', async () => {
    const job = await previewedJob(['Parvati']);
    const page = ok(await listImportRows({ entityId: 1, jobId: job.id }));
    expect(page).toMatchObject({ nextAfter: null, customers: {} });
    expect(page.rows.map((r) => r.state)).toEqual(['valid']);
  });
});

describe('one import and the saved column matchings', () => {
  it('answers one job to someone who may import, and refuses anyone else', async () => {
    const job = await previewedJob(['Savitri']);
    expect(ok(await getImportJob({ entityId: 1, jobId: job.id }))).toMatchObject({
      id: job.id,
      state: 'previewed',
      validRows: 1,
    });
    await expect(getImportJob({ entityId: 1, jobId: 'not-a-job' })).resolves.toMatchObject({
      ok: false,
      error: 'validation_failed',
    });
    await expect(getImportJob({ entityId: 2, jobId: job.id })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    request.principal = principalFor('tele_caller_cc', [1]);
    await expect(getImportJob({ entityId: 1, jobId: job.id })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    request.principal = undefined;
    await expect(getImportJob({ entityId: 1, jobId: job.id })).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
  });

  it('lists a matching saved from a job, and refuses someone who may not import', async () => {
    const csv = `Name,Mobile,Village\nGanga,${phone()},Sikar\n`;
    const job = ok(await uploadImportFile(uploadForm(csv)));
    const name = `Fair leads ${newId()}`;
    ok(await mapImportJob({ entityId: 1, jobId: job.id, mapping, saveAsTemplate: { name } }));
    const templates = ok(await listImportTemplates({ entityId: 1, kind: 'leads' }));
    expect(templates.find((t) => t.name === name)).toMatchObject({ kind: 'leads', mapping });

    await expect(listImportTemplates({ entityId: 1, kind: 'soap' })).resolves.toMatchObject({
      ok: false,
      error: 'validation_failed',
    });
    request.principal = principalFor('tele_caller_cc', [1]);
    await expect(listImportTemplates({ entityId: 1, kind: 'leads' })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});

describe('an import from start to finish, with no queue', () => {
  it('commits the leads in this process and rolls them back', async () => {
    const previewed = await previewedJob(['Bhanwar', 'Kamla', 'Ramesh']);
    expect(previewed).toMatchObject({ state: 'previewed', validRows: 3 });

    const committed = ok(await commitImportJob({ entityId: 1, jobId: previewed.id }, newId()));
    expect(committed).toMatchObject({ state: 'committed', committedRows: 3 });
    expect(await liveLeads(previewed.id)).toBe(3);
    expect(request.published).toEqual([]);

    const rolled = ok(await rollbackImportJob({ entityId: 1, jobId: previewed.id }));
    expect(rolled.state).toBe('rolled_back');
    expect(await liveLeads(previewed.id)).toBe(0);
  });
});

// Low-entropy phrases, so the secret scan never mistakes them for real keys (CLAUDE.md).
const CURRENT_KEY = 'imports-route-test-current-signing-key';
const ROUTE_URL = 'http://localhost:3000/api/v1/workers/imports/commit';
const QSTASH_ENV = ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'];

describe('POST /api/v1/workers/imports/commit', () => {
  const saved = new Map<string, string | undefined>();
  beforeEach(() => {
    for (const name of [...QSTASH_ENV, 'BETTER_AUTH_URL']) saved.set(name, process.env[name]);
    process.env.QSTASH_TOKEN = 'imports-route-test-token';
    process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT_KEY;
    process.env.QSTASH_NEXT_SIGNING_KEY = 'imports-route-test-next-signing-key';
    process.env.BETTER_AUTH_URL = 'http://localhost:3000';
  });
  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(process.env, name);
      else process.env[name] = value;
    }
  });

  const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

  /** A signature as QStash makes it: an HS256 token naming the route and the body's hash. */
  function sign(body: string, key = CURRENT_KEY): string {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: 'Upstash',
        sub: ROUTE_URL,
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

  function call(body: string, signature?: string, requestId?: string): Promise<Response> {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (signature !== undefined) headers.set('upstash-signature', signature);
    if (requestId !== undefined) headers.set('x-request-id', requestId);
    return POST(new Request(ROUTE_URL, { method: 'POST', headers, body }));
  }

  it("answers with the caller's well-formed request id, and a new one for any other", async () => {
    const body = JSON.stringify({ jobId: 'not a job' });
    const given = `imports-route-${newId()}`;
    const kept = await call(body, sign(body), given);
    expect(kept.status).toBe(400);
    expect(kept.headers.get('x-request-id')).toBe(given);
    expect(ErrorEnvelope.parse(await kept.json()).error).toMatchObject({
      code: 'validation_failed',
      requestId: given,
    });

    const replaced = await call(body, sign(body), 'not safe to echo');
    expect(replaced.headers.get('x-request-id')).not.toBe('not safe to echo');
    expect(replaced.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);

    // The platform's id wins over the caller's, as on every route and action.
    const platform = `bom1::route-${newId()}`;
    const hosted = await POST(
      new Request(ROUTE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'upstash-signature': sign(body),
          'x-vercel-id': platform,
          'x-request-id': given,
        },
        body,
      }),
    );
    expect(hosted.status).toBe(400);
    expect(hosted.headers.get('x-request-id')).toBe(platform);
  });

  it('refuses a body larger than a worker call carries, reading none of a declared one', async () => {
    const body = JSON.stringify({ jobId: newId(), entityId: 1, userId: newId() });
    const declared = new Request(ROUTE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'upstash-signature': sign(body),
        'content-length': '1048576',
      },
      body,
    });
    const refused = await POST(declared);
    expect(refused.status).toBe(400);
    expect(refused.headers.get('upstash-nonretryable-error')).toBe('true');
    expect(ErrorEnvelope.parse(await refused.json()).error.code).toBe('validation_failed');
    expect(declared.bodyUsed).toBe(false);

    const big = JSON.stringify({ jobId: newId(), pad: 'x'.repeat(8 * 1024) });
    const streamed = await POST(
      new Request(ROUTE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'upstash-signature': sign(big) },
        body: new Blob([big]).stream(),
        duplex: 'half',
      } as RequestInit),
    );
    expect(streamed.status).toBe(400);
    expect(ErrorEnvelope.parse(await streamed.json()).error.code).toBe('validation_failed');
  });

  /** A job the command has moved to committing, with no worker started for it yet. */
  async function committingJob(names: string[]): Promise<ImportJobDto> {
    const job = await previewedJob(names);
    return executeCommand(gm, { entityIds: [1] }, commitImportJobCommand, {
      entityId: 1,
      jobId: job.id,
    });
  }

  it('answers 503 and does nothing where the queue is not configured', async () => {
    const job = await committingJob(['Unconfigured']);
    Reflect.deleteProperty(process.env, 'QSTASH_TOKEN');
    const body = JSON.stringify({ jobId: job.id, entityId: 1, userId: gm.id });
    const response = await call(body, sign(body));
    expect(response.status).toBe(503);
    expect(ErrorEnvelope.parse(await response.json()).error.code).toBe('integration_unavailable');
    expect(await liveLeads(job.id)).toBe(0);
  });

  it.each([
    ['no signature', () => undefined],
    ['a signature made with another key', (body: string) => sign(body, 'some-other-signing-key')],
    ['a signature of another body', () => sign('{}')],
  ])('refuses a call with %s', async (_label, signatureFor) => {
    const job = await committingJob(['Unsigned']);
    const body = JSON.stringify({ jobId: job.id, entityId: 1, userId: gm.id });
    const response = await call(body, signatureFor(body));
    expect(response.status).toBe(401);
    expect(ErrorEnvelope.parse(await response.json()).error.code).toBe('unauthorized');
    expect(await liveLeads(job.id)).toBe(0);
  });

  it('commits the job as the person who asked, for a signed call', async () => {
    const job = await committingJob(['Signed one', 'Signed two']);
    const body = JSON.stringify({ jobId: job.id, entityId: 1, userId: gm.id });
    const response = await call(body, sign(body));
    expect(response.status).toBe(200);
    expect(ImportCommitWorkerResponse.parse(await response.json())).toMatchObject({
      jobId: job.id,
      state: 'committed',
      committedRows: 2,
    });
    expect(await liveLeads(job.id)).toBe(2);
  });

  it('hands the next run to the queue with an id that names the job and its progress', async () => {
    const body = { jobId: newId(), entityId: 1, userId: gm.id };
    await scheduleImportCommit(body, 500);
    await scheduleImportCommit(body, 500);
    expect(request.published).toEqual([
      expect.objectContaining({ body, deduplicationId: importRunId(body.jobId, 500) }),
      expect.objectContaining({ body, deduplicationId: importRunId(body.jobId, 500) }),
    ]);
    expect(importRunId(body.jobId, 500)).not.toBe(importRunId(body.jobId, 1000));
  });
});
