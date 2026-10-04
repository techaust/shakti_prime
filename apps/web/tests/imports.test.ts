import {
  ErrorEnvelope,
  IMPORT_LIMITS,
  ImportCommitWorkerResponse,
  newId,
  type DeliveredEvent,
  type ImportJobDto,
  type Principal,
} from '@shakti/contracts';
import { closeOutboxDb } from '@shakti/db/outbox';
import {
  ALL_ENTITY_IDS,
  asMigrator,
  asOutboxPublisher,
  closeDb,
  createTestPrincipal,
  createTestUser,
  principalFor,
} from '@shakti/db/testing';
import {
  commitImportJob as commitImportJobCommand,
  executeCommand,
  memoryFileStore,
  sha256Hex,
  type FileStore,
} from '@shakti/domain';
import { createHash, createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The import actions and worker outside a Next.js request, as in `actions.test.ts`: the request
// headers, the signed-in caller, the file store and the queue client are stand-ins; the commands,
// the upload flow, the file checks, the parser and the database are real.
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
  startImport,
} = await import('../src/actions/imports');
const { startUpload } = await import('../src/actions/files');
const { completeUploadFor, presignUpload } = await import('../src/files/uploads');
const { handleFileUploaded } = await import('../src/workers/files/handle-file-uploaded');
const { POST } = await import('../src/app/api/v1/workers/imports/commit/route');
const { giveUpImportCommit, importRunId, scheduleImportCommit } =
  await import('../src/workers/imports');

let files: ReturnType<typeof memoryFileStore>;
let gm: Principal;
let checker: Principal;

beforeAll(async () => {
  // A General Manager of Shakti Supreme with an authenticator app, as the worker resolves them.
  const user = await createTestUser([{ entityId: 1, roleKey: 'general_manager' }], {
    twoFactorEnabled: true,
  });
  gm = principalFor('general_manager', [1], { id: user.id });
  // The file checks' principal, as the worker of `files.file.uploaded` acts.
  checker = await createTestPrincipal('executive', ALL_ENTITY_IDS, {
    permissions: [{ key: 'files.process', scope: 'all' }],
  });
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

const CSV = 'text/csv';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function fileUploaded(fileId: string): DeliveredEvent {
  return {
    id: newId(),
    sequence: '1',
    type: 'files.file.uploaded',
    entityId: 1,
    aggregateType: 'file',
    aggregateId: fileId,
    payload: { purpose: 'import', v: 1 },
  };
}

/**
 * An import file as the screen uploads it: the upload is recorded and signed, the bytes land in
 * the store under the key it signed, the upload is completed, and, unless `check` is false, the
 * checks run as their worker does. Answers the file's id.
 */
async function uploaded(
  content: string | Uint8Array,
  options: { name?: string; contentType?: string; check?: boolean; as?: Principal } = {},
): Promise<string> {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const contentType = options.contentType ?? CSV;
  const caller = options.as ?? gm;
  const call = { requestId: newId(), options: {} };
  const slot = await presignUpload(
    caller,
    {
      entityId: 1,
      purpose: 'import',
      name: options.name ?? 'fair-leads.csv',
      contentType,
      size: bytes.length,
      sha256: sha256Hex(bytes),
    } as never,
    call,
    files,
  );
  const [key] = [...new URL(slot.uploadUrl).pathname.split('/').slice(1)].join('/').split('?');
  await files.put(key ?? '', bytes, contentType);
  await completeUploadFor(caller, slot.fileId, 'import', call, files);
  if (options.check !== false) {
    await handleFileUploaded(fileUploaded(slot.fileId), {
      store: files,
      principal: checker,
      hosted: false,
    });
  }
  return slot.fileId;
}

/** How many jobs a file started. */
async function jobsOf(fileId: string): Promise<number> {
  const [row] = await asMigrator(
    (m) => m<{ n: number }[]>`select count(*)::int as n from import_jobs where file_id = ${fileId}`,
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

/** A started import of a CSV file. */
async function startedJob(csv: string, name = 'fair-leads.csv'): Promise<ImportJobDto> {
  const fileId = await uploaded(csv, { name });
  return ok(await startImport({ entityId: 1, kind: 'leads', fileId }, newId()));
}

/** Uploads a CSV of the given names and takes it through mapping and preview. */
async function previewedJob(names: string[]): Promise<ImportJobDto> {
  const csv = `Name,Mobile,Village\n${names.map((n) => `${n},${phone()},Jhunjhunu`).join('\n')}\n`;
  const job = await startedJob(csv);
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

describe('an import file on the pre-signed upload', () => {
  it('refuses an import file over the limit before any byte is sent', async () => {
    const result = await startUpload(
      {
        entityId: 1,
        purpose: 'import',
        name: 'big.csv',
        contentType: CSV,
        size: IMPORT_LIMITS.maxFileBytes + 1,
        sha256: 'a'.repeat(64),
      },
      newId(),
    );
    expect(result).toMatchObject({ ok: false, error: 'file_too_large' });
  });

  it('refuses an import file of another type, and a spreadsheet of another purpose', async () => {
    const photo = {
      entityId: 1,
      purpose: 'import',
      name: 'photo.png',
      contentType: 'image/png',
      size: 10,
      sha256: 'a'.repeat(64),
    };
    expect(await startUpload(photo, newId())).toMatchObject({
      ok: false,
      error: 'validation_failed',
    });
    expect(
      await startUpload({ ...photo, purpose: 'consent_evidence', contentType: CSV }, newId()),
    ).toMatchObject({ ok: false, error: 'validation_failed' });
  });

  it('refuses at the checks a file that is not the spreadsheet it says it is', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
    const fileId = await uploaded(png, { name: 'photo.csv' });
    const [row] = await asMigrator(
      (m) => m<{ status: string; scan_result: unknown }[]>`
        select status, scan_result from files where id = ${fileId}`,
    );
    expect(row).toMatchObject({ status: 'rejected', scan_result: { rejectReason: 'file_unreadable' } });
    expect(await startImport({ entityId: 1, kind: 'leads', fileId }, newId())).toEqual({
      ok: false,
      error: 'import_file_unreadable',
    });
  });

  it('refuses someone who may not import, before the file is read', async () => {
    const fileId = await uploaded(`Name,Mobile\nRam,${phone()}\n`);
    request.principal = principalFor('tele_caller_cc', [1]);
    expect(await startImport({ entityId: 1, kind: 'leads', fileId }, newId())).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(await jobsOf(fileId)).toBe(0);
  });

  it('reads the checked file and records the job and its rows', async () => {
    const csv = `Name,Mobile,Village\nGopal,${phone()},Churu\nMeera,${phone()},\n`;
    const fileId = await uploaded(csv);
    const [row] = await asMigrator(
      (m) => m<{ status: string; scan_result: unknown }[]>`
        select status, scan_result from files where id = ${fileId}`,
    );
    expect(row).toMatchObject({ status: 'ready', scan_result: { sanitising: 'sheet_checked' } });
    const job = ok(await startImport({ entityId: 1, kind: 'leads', fileId }, newId()));
    expect(job).toMatchObject({
      state: 'uploaded',
      kind: 'leads',
      format: 'csv',
      totalRows: 2,
      file: { id: fileId, name: 'fair-leads.csv' },
    });
  });

  it('starts a customers file in a request for the companies the person works in', async () => {
    const csv = `Customer,Mobile No,Village\nDhanni,${phone()},Sikar\nPushpa,${phone()},Churu\n`;
    const fileId = await uploaded(csv, { name: 'customers.csv' });
    const job = ok(await startImport({ entityId: 1, kind: 'accounts', fileId }, newId()));
    expect(job).toMatchObject({ kind: 'accounts', format: 'csv', totalRows: 2 });
    expect(job.columns).toEqual(['Customer', 'Mobile No', 'Village']);
    const rows = ok(await listImportRows({ entityId: 1, jobId: job.id }));
    expect(rows.rows.map((r) => r.raw.Customer)).toEqual(['Dhanni', 'Pushpa']);
  });

  it('refuses a workbook whose bytes are not one, at the checks', async () => {
    const fileId = await uploaded('Name,Mobile\nNot a workbook,9876543210\n', {
      name: 'customers.xlsx',
      contentType: XLSX,
    });
    expect(await startImport({ entityId: 1, kind: 'accounts', fileId }, newId())).toEqual({
      ok: false,
      error: 'import_file_unreadable',
    });
  });

  it('asks again later for a file still in its checks', async () => {
    const fileId = await uploaded(`Name,Mobile\nKishan,${phone()}\n`, { check: false });
    expect(await startImport({ entityId: 1, kind: 'leads', fileId }, newId())).toEqual({
      ok: false,
      error: 'import_file_not_ready',
    });
    await handleFileUploaded(fileUploaded(fileId), { store: files, principal: checker, hosted: false });
    ok(await startImport({ entityId: 1, kind: 'leads', fileId }, newId()));
    expect(await jobsOf(fileId)).toBe(1);
  });

  it('starts one job from one file, and refuses the same content uploaded again', async () => {
    const csv = `Name,Mobile\nHari,${phone()}\n`;
    const fileId = await uploaded(csv);
    ok(await startImport({ entityId: 1, kind: 'leads', fileId }, newId()));
    expect(await startImport({ entityId: 1, kind: 'leads', fileId }, newId())).toEqual({
      ok: false,
      error: 'import_file_duplicate',
    });
    const again = await uploaded(csv);
    expect(await startImport({ entityId: 1, kind: 'leads', fileId: again }, newId())).toEqual({
      ok: false,
      error: 'import_file_duplicate',
    });
    expect(await jobsOf(again)).toBe(0);
  });

  it('answers a plain sentence when the stored bytes are gone or no store exists', async () => {
    const fileId = await uploaded(`Name,Mobile\nSundar,${phone()}\n`);
    const kept = files;
    request.store = memoryFileStore();
    const gone = await startImport({ entityId: 1, kind: 'leads', fileId }, newId());
    expect(gone).toMatchObject({ ok: false, error: 'import_store_failed' });
    expect(gone.ok ? undefined : gone.reference).toEqual(expect.any(String));
    request.store = undefined;
    expect(await startImport({ entityId: 1, kind: 'leads', fileId }, newId())).toMatchObject({
      ok: false,
      error: 'files_unavailable',
    });
    request.store = kept;
    ok(await startImport({ entityId: 1, kind: 'leads', fileId }, newId()));
  });

  it('offers the PIN code list only to a request for every company', async () => {
    const fileId = await uploaded('PIN,Office,District\n332001,Sikar H.O,Sikar\n', {
      name: 'pin-codes.csv',
    });
    expect(await startImport({ entityId: 1, kind: 'pin_codes', fileId }, newId())).toEqual({
      ok: false,
      error: 'import_needs_all_companies',
    });
    expect(await jobsOf(fileId)).toBe(0);
  });
});

describe('the list of imports', () => {
  it('shows the new job among the newest, with the name of the person who started it', async () => {
    const job = await startedJob(`Name,Mobile\nLakshmi,${phone()}\n`);
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
    const job = await startedJob(`Name,Mobile,Village\nGanga,${phone()},Sikar\n`);
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

  it('answers a retryable 503 when another run holds the job past the lock wait, failing nothing', async () => {
    const job = await committingJob(['Overlap one', 'Overlap two']);
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let taken: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      taken = resolve;
    });
    // Another run of the same job holds its row, as an overlapping retry of one message would.
    const holder = asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`select id from import_jobs where id = ${job.id} for update`;
        taken();
        await released;
      }),
    );
    await held;
    const body = JSON.stringify({ jobId: job.id, entityId: 1, userId: gm.id });
    try {
      const busy = await call(body, sign(body));
      expect(busy.status).toBe(503);
      expect(busy.headers.get('upstash-nonretryable-error')).toBeNull();
    } finally {
      release();
      await holder;
    }
    const [state] = await asMigrator(
      (m) => m<{ state: string; failed: number | null }[]>`
        select state, failed_batch as failed from import_jobs where id = ${job.id}`,
    );
    expect(state).toEqual({ state: 'committing', failed: null });
    const retried = await call(body, sign(body));
    expect(retried.status).toBe(200);
    expect(await liveLeads(job.id)).toBe(2);
  }, 60_000);

  it("records each batch under the route's request id, as its answer and log carry it", async () => {
    const job = await committingJob(['Traced one', 'Traced two']);
    const body = JSON.stringify({ jobId: job.id, entityId: 1, userId: gm.id });
    const given = `imports-trace-${newId()}`;
    const response = await call(body, sign(body), given);
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe(given);
    const rows = await asMigrator(
      (m) => m<{ command: string; outcome: string; request_id: string }[]>`
        select command, outcome, request_id from audit_logs
         where command = 'imports.job.commit_batch' and aggregate_id = ${job.id}`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toEqual({
        command: 'imports.job.commit_batch',
        outcome: 'ok',
        request_id: given,
      });
    }
  });

  it('fails the job on the queue’s last retry rather than leaving it committing', async () => {
    const job = await committingJob(['Last try one', 'Last try two']);
    // Another run holds the job's row a little past the lock wait, so the commit gives up waiting;
    // by the time the route fails the job, the row is free again.
    let taken: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      taken = resolve;
    });
    const holder = asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`select id from import_jobs where id = ${job.id} for update`;
        taken();
        await new Promise((resolve) => setTimeout(resolve, 11_000));
      }),
    );
    await held;
    const body = JSON.stringify({ jobId: job.id, entityId: 1, userId: gm.id });
    try {
      const headers = new Headers({
        'content-type': 'application/json',
        'upstash-signature': sign(body),
        'upstash-retried': '3',
      });
      const response = await POST(new Request(ROUTE_URL, { method: 'POST', headers, body }));
      expect(response.status).toBe(200);
      expect(ImportCommitWorkerResponse.parse(await response.json())).toMatchObject({
        jobId: job.id,
        state: 'failed',
        committedRows: 0,
      });
    } finally {
      await holder;
    }
    const failed = await asOutboxPublisher(
      (p) => p<{ type: string; payload_json: unknown }[]>`
        select type, payload_json from outbox_events
         where aggregate_id = ${job.id} and type = 'imports.job.failed'`,
    );
    expect(failed).toEqual([
      { type: 'imports.job.failed', payload_json: expect.objectContaining({ failedBatch: 1 }) },
    ]);
  }, 60_000);

  it('gives up on a job only while it commits, and leaves a finished one as it is', async () => {
    const job = await committingJob(['Given up']);
    const body = { jobId: job.id, entityId: 1, userId: gm.id };
    expect(await giveUpImportCommit(body, newId())).toMatchObject({ state: 'failed' });
    // Asked again (a second delivery of the same last retry), nothing changes.
    expect(await giveUpImportCommit(body, newId())).toMatchObject({ state: 'failed' });
    const done = await committingJob(['Finished first']);
    const run = await call(
      JSON.stringify({ jobId: done.id, entityId: 1, userId: gm.id }),
      sign(JSON.stringify({ jobId: done.id, entityId: 1, userId: gm.id })),
    );
    expect(run.status).toBe(200);
    expect(
      await giveUpImportCommit({ jobId: done.id, entityId: 1, userId: gm.id }, newId()),
    ).toMatchObject({ state: 'committed', committedRows: 1 });
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
