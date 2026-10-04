import { ErrorEnvelope, newId, type Principal } from '@shakti/contracts';
import { asMigrator, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { memoryFileStore, sha256Hex, type FileStore } from '@shakti/domain';
import { createHash, createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The sweep of abandoned uploads (docs/design/phase1.md §6.3) outside a Next.js request: the file
// store is a stand-in; the upload command, the sweep, its query and the database are real.
const state = vi.hoisted((): { store: FileStore | undefined } => ({ store: undefined }));
vi.mock('../src/files/store', () => ({ fileStore: () => state.store }));

const { presignUpload } = await import('../src/files/uploads');
const { sweepAbandonedUploads } = await import('../src/workers/files/sweep-uploads');
const { POST } = await import('../src/app/api/v1/workers/files/sweep/route');

let gm: Principal;
let files: ReturnType<typeof memoryFileStore>;

beforeAll(async () => {
  gm = await createTestPrincipal('general_manager', [1]);
});
afterAll(async () => {
  await closeDb();
});
beforeEach(() => {
  files = memoryFileStore();
  state.store = files;
});

/** An upload begun and never completed, its bytes landed or not, begun `hoursAgo` hours ago. */
async function pendingUpload(hoursAgo: number, landed: boolean) {
  const bytes = new TextEncoder().encode(`Name,Mobile\nSweep ${newId()},9876543210\n`);
  const slot = await presignUpload(
    gm,
    {
      entityId: 1,
      purpose: 'import',
      name: 'never-finished.csv',
      contentType: 'text/csv',
      size: bytes.length,
      sha256: sha256Hex(bytes),
    } as never,
    { requestId: newId(), options: {} },
    files,
  );
  const key = new URL(slot.uploadUrl).pathname.slice(1);
  if (landed) await files.put(key, bytes, 'text/csv');
  await asMigrator(
    (m) => m`update files set created_at = now() - make_interval(hours => ${hoursAgo})
              where id = ${slot.fileId}`,
  );
  return { fileId: slot.fileId, key };
}

async function fileOf(id: string) {
  const [row] = await asMigrator(
    (m) => m<{ status: string; reason: string | null }[]>`
      select status, scan_result ->> 'rejectReason' as reason from files where id = ${id}`,
  );
  return row;
}

describe('the sweep of abandoned uploads', () => {
  it('refuses an upload still pending a day after it began and deletes the bytes that landed', async () => {
    const stale = await pendingUpload(25, true);
    const staleNoBytes = await pendingUpload(30, false);
    const fresh = await pendingUpload(1, true);

    const swept = await sweepAbandonedUploads({ store: files, requestId: newId() });
    expect(swept.companies).toBeGreaterThanOrEqual(1);
    expect(swept.abandoned).toBeGreaterThanOrEqual(2);

    expect(await fileOf(stale.fileId)).toEqual({
      status: 'rejected',
      reason: 'file_upload_abandoned',
    });
    expect(await fileOf(staleNoBytes.fileId)).toEqual({
      status: 'rejected',
      reason: 'file_upload_abandoned',
    });
    expect(files.objects.has(stale.key)).toBe(false);
    // An upload that may still be going is left alone, with its bytes.
    expect(await fileOf(fresh.fileId)).toEqual({ status: 'pending', reason: null });
    expect(files.objects.has(fresh.key)).toBe(true);

    const [audit] = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from audit_logs
                                 where command = 'files.upload.sweep' and aggregate_id = ${stale.fileId}`,
    );
    expect(audit?.n).toBe(1);
  });

  it('leaves the records right when a deletion fails, and a second run finds nothing more', async () => {
    const stale = await pendingUpload(26, true);
    const failing: FileStore = {
      ...files,
      delete: () => Promise.reject(new Error('the store is down')),
    };
    const lines: string[] = [];
    await sweepAbandonedUploads({
      store: failing,
      requestId: newId(),
      logger: {
        log: (_level, event) => {
          lines.push(event);
        },
      },
    });
    expect(await fileOf(stale.fileId)).toMatchObject({ status: 'rejected' });
    expect(lines).toContain('files.sweep_delete_failed');

    const again = await sweepAbandonedUploads({ store: files, requestId: newId() });
    expect(await fileOf(stale.fileId)).toMatchObject({ status: 'rejected' });
    expect(again.abandoned).toBe(0);
  });
});

const CURRENT_KEY = 'files-sweep-route-test-current-signing-key';
const ROUTE_URL = 'http://localhost:3000/api/v1/workers/files/sweep';
const QSTASH_ENV = ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'];

describe('POST /api/v1/workers/files/sweep', () => {
  const saved = new Map<string, string | undefined>();
  beforeEach(() => {
    for (const name of [...QSTASH_ENV, 'BETTER_AUTH_URL']) saved.set(name, process.env[name]);
    process.env.QSTASH_TOKEN = 'files-sweep-route-test-token';
    process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT_KEY;
    process.env.QSTASH_NEXT_SIGNING_KEY = 'files-sweep-route-test-next-signing-key';
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
  function sign(body: string, url = ROUTE_URL): string {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const claims = base64url(
      JSON.stringify({
        iss: 'Upstash',
        sub: url,
        iat: now,
        nbf: now,
        exp: now + 300,
        jti: newId(),
        body: createHash('sha256').update(body).digest('base64url'),
      }),
    );
    const signature = createHmac('sha256', CURRENT_KEY)
      .update(`${header}.${claims}`)
      .digest('base64url');
    return `${header}.${claims}.${signature}`;
  }

  function call(body: string, signature?: string): Promise<Response> {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (signature !== undefined) headers.set('upstash-signature', signature);
    return POST(new Request(ROUTE_URL, { method: 'POST', headers, body }));
  }

  it('refuses a call with no signature, or one signed for another route, sweeping nothing', async () => {
    const stale = await pendingUpload(25, true);
    const unsigned = await call('{}');
    expect(unsigned.status).toBe(401);
    expect(ErrorEnvelope.parse(await unsigned.json()).error.code).toBe('unauthorized');
    const elsewhere = await call(
      '{}',
      sign('{}', 'http://localhost:3000/api/v1/workers/imports/commit'),
    );
    expect(elsewhere.status).toBe(401);
    expect(await fileOf(stale.fileId)).toMatchObject({ status: 'pending' });
  });

  it('answers 503 where the queue is not configured', async () => {
    Reflect.deleteProperty(process.env, 'QSTASH_CURRENT_SIGNING_KEY');
    const response = await call('{}', sign('{}'));
    expect(response.status).toBe(503);
  });

  it('sweeps for a signed call and answers the counts', async () => {
    const stale = await pendingUpload(25, true);
    const response = await call('{}', sign('{}'));
    expect(response.status).toBe(200);
    const answer = (await response.json()) as { companies: number; abandoned: number };
    expect(answer.abandoned).toBeGreaterThanOrEqual(1);
    expect(await fileOf(stale.fileId)).toMatchObject({ status: 'rejected' });
    expect(files.objects.has(stale.key)).toBe(false);
  });
});
