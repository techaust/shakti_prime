import {
  ErrorEnvelope,
  FilePresignResponse,
  newId,
  type DeliveredEvent,
  type FilePurpose,
  type Principal,
} from '@shakti/contracts';
import { closeOutboxDb } from '@shakti/db/outbox';
import { ALL_ENTITY_IDS, asMigrator, closeDb, createTestPrincipal } from '@shakti/db/testing';
import {
  localDiskFileStore,
  memoryFileStore,
  memoryKeyValue,
  sha256Hex,
  type FileStore,
} from '@shakti/domain';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The upload actions, routes and file checks outside a Next.js request, as in `imports.test.ts`:
// the request headers, the signed-in caller and the file store are stand-ins; the commands, the
// checks and the database are real.
interface RequestState {
  principal: Principal | undefined;
  headers: Headers;
  store: FileStore | undefined;
}

const request = vi.hoisted((): RequestState => ({
  principal: undefined,
  headers: new Headers(),
  store: undefined,
}));
const SECRET = 'files suite signing phrase for local addresses';

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(request.headers),
  cookies: () => Promise.resolve({ get: () => undefined, set: () => undefined }),
}));
vi.mock('../src/auth/current-principal', () => ({
  currentPrincipal: () => Promise.resolve(request.principal),
}));
vi.mock('../src/files/store', () => ({
  fileStore: () => request.store,
  localFilesSecret: () => SECRET,
}));

const { fileStatus, finishUpload, listCompanyBranding, openFile, startUpload } =
  await import('../src/actions/files');
const { localUpload } = await import('../src/files/local-route');
const { completeRoute, presignRoute, FILE_ROUTE_CAP } = await import('../src/files/routes');
const { completeUploadFor, presignUpload } = await import('../src/files/uploads');
const { handleFileUploaded, SCAN_TAG } = await import('../src/workers/files/handle-file-uploaded');

const ORIGIN = 'http://localhost:3000';
let dir: string;
let executive: Principal;
let worker: Principal;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shakti-upload-'));
  executive = await createTestPrincipal('executive', [1, 2]);
  // The worker principal's grants for the file checks: a vault upload's checks also look for the
  // vault files waiting on it (knowledge.index, docs/03-roadmap-appendix/phase1.md §8.4).
  worker = await createTestPrincipal('executive', ALL_ENTITY_IDS, {
    permissions: [
      { key: 'files.process', scope: 'all' },
      { key: 'knowledge.index', scope: 'all' },
    ],
  });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await closeOutboxDb();
  await closeDb();
});

beforeEach(() => {
  request.principal = executive;
  request.headers = new Headers({ origin: ORIGIN });
  request.store = localDiskFileStore(dir, {
    signing: { secret: SECRET, url: (t) => `${ORIGIN}/api/v1/files/local/${t}` },
  });
});

async function png(width = 32, height = 16): Promise<Uint8Array> {
  const bytes = await sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 60, b: 200 } },
  })
    .png()
    .withExif({ IFD0: { ImageDescription: 'Office front gate' } })
    .toBuffer();
  return new Uint8Array(bytes);
}

/** The same store, whose first deletion fails as an unreachable store would. */
function failingOnce<S extends FileStore>(store: S): S {
  let failed = false;
  return {
    ...store,
    delete: (key: string) => {
      if (!failed) {
        failed = true;
        return Promise.reject(new Error('the store could not be reached'));
      }
      return store.delete(key);
    },
  };
}

const pdf = (body: string): Uint8Array =>
  new TextEncoder().encode(`%PDF-1.7\n${body}\ntrailer\n%%EOF\n`);

function uploaded(
  fileId: string,
  entityId = 1,
  purpose: FilePurpose = 'entity_logo',
): DeliveredEvent {
  return {
    id: newId(),
    sequence: '1',
    type: 'files.file.uploaded',
    entityId,
    aggregateType: 'file',
    aggregateId: fileId,
    payload: { purpose, v: 1 },
  };
}

async function row(fileId: string) {
  const [found] = await asMigrator(
    (m) => m<{ status: string; key: string; size: number; sha256: string; scan_result: unknown }[]>`
      select status, key, size, sha256, scan_result from files where id = ${fileId}`,
  );
  if (!found) throw new Error(`no file ${fileId}`);
  return found;
}

/** Begins an upload as the Executive, puts the bytes where the store keeps them, completes it. */
async function landed(
  bytes: Uint8Array,
  target: { purpose?: FilePurpose; contentType?: string; store?: FileStore } = {},
): Promise<string> {
  const store = target.store ?? request.store;
  if (store === undefined) throw new Error('no store');
  const purpose = target.purpose ?? 'entity_logo';
  const contentType = target.contentType ?? 'image/png';
  const call = { requestId: newId(), options: {} };
  const slot = await presignUpload(
    executive,
    {
      entityId: 1,
      purpose,
      name: 'upload',
      contentType,
      size: bytes.length,
      sha256: sha256Hex(bytes),
    } as never,
    call,
    store,
  );
  const [, key] =
    /\/(1\/[a-z_]+\/[0-9a-f-]+\.[a-z]+)$/.exec(new URL(slot.uploadUrl).pathname) ?? [];
  await store.put(key ?? `1/${purpose}/${slot.fileId}.png`, bytes, contentType);
  await completeUploadFor(executive, slot.fileId, purpose, call, store);
  return slot.fileId;
}

describe('an upload from a screen, end to end on the development store', () => {
  it('signs, takes the bytes, starts the checks and ends ready with the metadata dropped', async () => {
    const bytes = await png();
    const sha256 = sha256Hex(bytes);
    const started = await startUpload(
      {
        entityId: 1,
        purpose: 'entity_logo',
        name: 'Logo.png',
        contentType: 'image/png',
        size: bytes.length,
        sha256,
      },
      newId(),
    );
    if (!started.ok) throw new Error(started.error);
    const slot = FilePresignResponse.parse(started.data);
    expect(slot.headers).toEqual({ 'content-type': 'image/png' });

    const token = slot.uploadUrl.split('/').pop() ?? '';
    const put = await localUpload(
      new Request(slot.uploadUrl, {
        method: 'PUT',
        headers: slot.headers,
        body: Buffer.from(bytes),
      }),
      token,
      { store: request.store, secret: SECRET, hosted: false },
    );
    expect(put.status).toBe(200);

    const finished = await finishUpload({ fileId: slot.fileId, purpose: 'entity_logo' }, newId());
    expect(finished).toMatchObject({ ok: true, data: { status: 'scanning' } });

    const store = request.store;
    if (store === undefined) throw new Error('no store');
    const outcome = await handleFileUploaded(uploaded(slot.fileId), {
      store,
      principal: worker,
      hosted: false,
    });
    expect(outcome).toEqual({ status: 'ready' });

    const stored = await row(slot.fileId);
    expect(stored.status).toBe('ready');
    expect(stored.key).toBe(`1/entity_logo/${slot.fileId}-checked.png`);
    expect(stored.scan_result).toMatchObject({ verdict: 'not_scanned', sanitising: 're_encoded' });
    const kept = await store.get(stored.key);
    expect(Buffer.from(kept ?? []).toString('latin1')).not.toContain('Office front gate');
    // The upload's own bytes are gone; only the checked copy is kept.
    expect(await store.get(`1/entity_logo/${slot.fileId}.png`)).toBeUndefined();

    expect(await fileStatus(slot.fileId)).toMatchObject({ ok: true, data: { status: 'ready' } });
    const opened = await openFile(slot.fileId);
    expect(opened.ok && opened.data.url.startsWith(`${ORIGIN}/api/v1/files/local/`)).toBe(true);
    const branding = await listCompanyBranding();
    expect(branding.ok && branding.data.some((f) => f.id === slot.fileId)).toBe(true);
  });

  it('refuses the upload before any byte when the purpose does not take it', async () => {
    const result = await startUpload({
      entityId: 1,
      purpose: 'entity_logo',
      name: 'Logo.pdf',
      contentType: 'application/pdf',
      size: 10,
      sha256: 'a'.repeat(64),
    });
    expect(result).toEqual({ ok: false, error: 'file_type_not_allowed' });
  });

  it('answers unavailable on a deployment without a file store', async () => {
    request.store = undefined;
    const result = await startUpload({
      entityId: 1,
      purpose: 'entity_logo',
      name: 'Logo.png',
      contentType: 'image/png',
      size: 10,
      sha256: 'a'.repeat(64),
    });
    expect(result).toMatchObject({ ok: false, error: 'files_unavailable' });
  });

  it('refuses to complete an upload whose bytes never landed', async () => {
    const started = await startUpload({
      entityId: 1,
      purpose: 'letterhead',
      name: 'Letterhead.png',
      contentType: 'image/png',
      size: 10,
      sha256: 'a'.repeat(64),
    });
    if (!started.ok) throw new Error(started.error);
    expect(await finishUpload({ fileId: started.data.fileId, purpose: 'letterhead' })).toEqual({
      ok: false,
      error: 'file_upload_mismatch',
    });
  });

  it('caps the upload calls one person makes from the screens, as the routes do', async () => {
    request.principal = await createTestPrincipal('executive', [1]);
    const input = { entityId: 1, purpose: 'entity_logo', name: 'x.png', contentType: 'image/png' };
    for (let i = 0; i < FILE_ROUTE_CAP.max; i += 1) {
      const within = i % 2 === 0 ? await startUpload(input) : await finishUpload({});
      expect(within).toMatchObject({ ok: false, error: 'validation_failed' });
    }
    expect(await startUpload(input)).toMatchObject({ ok: false, error: 'rate_limited' });
    expect(await finishUpload({})).toMatchObject({ ok: false, error: 'rate_limited' });
  });

  it('opens no file kept in another store than this one', async () => {
    const id = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
        values (${id}, 1, 'entity_logo', 'another-bucket', ${`1/entity_logo/${id}.png`}, 'Logo.png', 'image/png', 10, ${'a'.repeat(64)}, 'ready', ${executive.id})`,
    );
    expect(await openFile(id)).toEqual({ ok: false, error: 'file_missing' });
  });

  it('opens no file that is not ready', async () => {
    const started = await startUpload({
      entityId: 1,
      purpose: 'letterhead',
      name: 'Letterhead.png',
      contentType: 'image/png',
      size: 10,
      sha256: 'a'.repeat(64),
    });
    if (!started.ok) throw new Error(started.error);
    expect(await openFile(started.data.fileId)).toEqual({ ok: false, error: 'file_missing' });
  });
});

describe('the file checks', () => {
  const scannedStore = (): FileStore & ReturnType<typeof memoryFileStore> => ({
    ...memoryFileStore('test-bucket'),
    scanned: true,
  });

  it('wait for the malware scan, then pass a clean file', async () => {
    const store = scannedStore();
    const fileId = await landed(await png(), { store });
    const deps = { store, principal: worker, hosted: true };
    await expect(handleFileUploaded(uploaded(fileId), deps)).rejects.toMatchObject({
      code: 'integration_unavailable',
    });
    expect((await row(fileId)).status).toBe('scanning');
    const object = store.objects.get(`1/entity_logo/${fileId}.png`);
    if (object) object.tags[SCAN_TAG] = 'NO_THREATS_FOUND';
    expect(await handleFileUploaded(uploaded(fileId), deps)).toEqual({ status: 'ready' });
    expect((await row(fileId)).scan_result).toMatchObject({
      scanner: 'guardduty',
      verdict: 'no_threats_found',
    });
    // A second delivery finds the file ready and leaves it alone.
    expect(await handleFileUploaded(uploaded(fileId), deps)).toEqual({ status: 'ready' });
  });

  it.each([
    ['THREATS_FOUND', 'file_infected'],
    ['UNSUPPORTED', 'file_scan_failed'],
    ['ACCESS_DENIED', 'file_scan_failed'],
    ['FAILED', 'file_scan_failed'],
  ])('refuse a file the scan marked %s and delete its bytes', async (verdict, reason) => {
    const store = scannedStore();
    const fileId = await landed(await png(), { store });
    const key = `1/entity_logo/${fileId}.png`;
    const object = store.objects.get(key);
    if (object) object.tags[SCAN_TAG] = verdict;
    expect(
      await handleFileUploaded(uploaded(fileId), { store, principal: worker, hosted: true }),
    ).toEqual({ status: 'rejected' });
    expect((await row(fileId)).scan_result).toMatchObject({
      rejectReason: reason,
      scanStatus: verdict,
    });
    expect(store.objects.has(key)).toBe(false);
  });

  it('refuse a file no scanner looked at on a hosted runtime', async () => {
    const store = memoryFileStore('test-bucket');
    const fileId = await landed(await png(), { store });
    expect(
      await handleFileUploaded(uploaded(fileId), { store, principal: worker, hosted: true }),
    ).toEqual({ status: 'rejected' });
    expect((await row(fileId)).scan_result).toMatchObject({ rejectReason: 'file_not_scanned' });
  });

  it('refuse bytes changed after the upload', async () => {
    const store = memoryFileStore('test-bucket');
    const fileId = await landed(await png(), { store });
    const object = store.objects.get(`1/entity_logo/${fileId}.png`);
    if (object) object.bytes = await png(8, 8);
    expect(
      await handleFileUploaded(uploaded(fileId), { store, principal: worker, hosted: false }),
    ).toEqual({ status: 'rejected' });
    expect((await row(fileId)).scan_result).toMatchObject({ rejectReason: 'file_unreadable' });
  });

  it('keep a clean PDF as it is and refuse one that carries a script', async () => {
    const store = memoryFileStore('test-bucket');
    const clean = await landed(pdf('1 0 obj << /Type /Catalog >> endobj'), {
      store,
      purpose: 'signed_quote',
      contentType: 'application/pdf',
    });
    const deps = { store, principal: worker, hosted: false };
    expect(await handleFileUploaded(uploaded(clean, 1, 'signed_quote'), deps)).toEqual({
      status: 'ready',
    });
    const kept = await row(clean);
    expect(kept.key).toBe(`1/signed_quote/${clean}.pdf`);
    expect(kept.scan_result).toMatchObject({ sanitising: 'pdf_checked' });

    const data = deflateSync(Buffer.from('<< /S /JavaScript /JS (x) >>'));
    const script = await landed(
      new Uint8Array(
        Buffer.concat([
          Buffer.from('%PDF-1.7\n5 0 obj\n<< /Filter /FlateDecode >>\nstream\n'),
          data,
          Buffer.from('\nendstream\nendobj\n%%EOF\n'),
        ]),
      ),
      { store, purpose: 'signed_quote', contentType: 'application/pdf' },
    );
    expect(await handleFileUploaded(uploaded(script, 1, 'signed_quote'), deps)).toEqual({
      status: 'rejected',
    });
    expect((await row(script)).scan_result).toMatchObject({
      rejectReason: 'file_pdf_active_content',
    });
  });

  describe('for a vault photo', () => {
    /** A vault photo the worker recorded, as a vault upload's checks find it. */
    async function vaultPhoto(store: FileStore): Promise<string> {
      const bytes = await png();
      const id = newId();
      const key = `1/knowledge/${id}.png`;
      await store.put(key, bytes, 'image/png');
      await asMigrator(
        (
          m,
        ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
          values (${id}, 1, 'knowledge', ${store.bucket}, ${key}, 'card.png', 'image/png', ${bytes.length}, ${sha256Hex(bytes)}, 'scanning', ${worker.id})`,
      );
      return id;
    }

    it('keeps only the masked copy', async () => {
      const store = memoryFileStore('test-bucket');
      const fileId = await vaultPhoto(store);
      const masked = await sharp({
        create: { width: 4, height: 4, channels: 3, background: '#000000' },
      })
        .jpeg()
        .toBuffer();
      const masker = () =>
        Promise.resolve({
          mask: (photo: Buffer) => {
            photo.fill(0);
            return Promise.resolve({ status: 'masked', image: masked, rects: 2 } as never);
          },
          close: () => Promise.resolve(),
        });
      expect(
        await handleFileUploaded(uploaded(fileId, 1, 'knowledge'), {
          store,
          principal: worker,
          hosted: false,
          masker,
        }),
      ).toEqual({ status: 'ready' });
      const kept = await row(fileId);
      expect(kept.key).toBe(`1/knowledge/${fileId}-checked.jpg`);
      expect(kept.scan_result).toMatchObject({ sanitising: 'masked', regionsMasked: 2 });
      expect(store.objects.has(`1/knowledge/${fileId}.png`)).toBe(false);
    });

    it('keeps nothing when the numbers could not be found', async () => {
      const store = memoryFileStore('test-bucket');
      const fileId = await vaultPhoto(store);
      const masker = () =>
        Promise.resolve({
          mask: () => Promise.resolve({ status: 'needs_review' } as never),
          close: () => Promise.resolve(),
        });
      expect(
        await handleFileUploaded(uploaded(fileId, 1, 'knowledge'), {
          store,
          principal: worker,
          hosted: false,
          masker,
        }),
      ).toEqual({ status: 'rejected' });
      expect((await row(fileId)).scan_result).toMatchObject({ rejectReason: 'file_mask_failed' });
      expect(store.objects.size).toBe(0);
    });

    it('deletes the unmasked photo on the next delivery when the first deletion failed', async () => {
      const store = memoryFileStore('test-bucket');
      const fileId = await vaultPhoto(store);
      const masked = await sharp({
        create: { width: 4, height: 4, channels: 3, background: '#000000' },
      })
        .jpeg()
        .toBuffer();
      const masker = () =>
        Promise.resolve({
          mask: () => Promise.resolve({ status: 'masked', image: masked, rects: 1 } as never),
          close: () => Promise.resolve(),
        });
      const deps = { store: failingOnce(store), principal: worker, hosted: false, masker };
      await expect(handleFileUploaded(uploaded(fileId, 1, 'knowledge'), deps)).rejects.toThrow(
        'the store could not be reached',
      );
      expect((await row(fileId)).status).toBe('ready');
      expect(store.objects.has(`1/knowledge/${fileId}.png`)).toBe(true);
      expect(await handleFileUploaded(uploaded(fileId, 1, 'knowledge'), deps)).toEqual({
        status: 'ready',
      });
      expect(store.objects.has(`1/knowledge/${fileId}.png`)).toBe(false);
      expect(store.objects.has(`1/knowledge/${fileId}-checked.jpg`)).toBe(true);
    });

    it('waits when no masking step is available', async () => {
      const store = memoryFileStore('test-bucket');
      const fileId = await vaultPhoto(store);
      await expect(
        handleFileUploaded(uploaded(fileId, 1, 'knowledge'), {
          store,
          principal: worker,
          hosted: false,
        }),
      ).rejects.toMatchObject({ code: 'integration_unavailable' });
    });
  });

  describe('never keep the upload’s own bytes after a deletion that failed once', () => {
    it('for a re-encoded picture', async () => {
      const store = memoryFileStore('test-bucket');
      const fileId = await landed(await png(), { store });
      const deps = { store: failingOnce(store), principal: worker, hosted: false };
      await expect(handleFileUploaded(uploaded(fileId), deps)).rejects.toThrow(
        'the store could not be reached',
      );
      const kept = await row(fileId);
      expect(kept.status).toBe('ready');
      expect(kept.scan_result).toMatchObject({ originalKey: `1/entity_logo/${fileId}.png` });
      expect(store.objects.has(`1/entity_logo/${fileId}.png`)).toBe(true);
      expect(await handleFileUploaded(uploaded(fileId), deps)).toEqual({ status: 'ready' });
      expect(store.objects.has(`1/entity_logo/${fileId}.png`)).toBe(false);
      expect(store.objects.has(kept.key)).toBe(true);
    });

    it('for a refused file', async () => {
      const store = memoryFileStore('test-bucket');
      const fileId = await landed(await png(), { store });
      const deps = { store: failingOnce(store), principal: worker, hosted: true };
      await expect(handleFileUploaded(uploaded(fileId), deps)).rejects.toThrow(
        'the store could not be reached',
      );
      expect((await row(fileId)).status).toBe('rejected');
      expect(store.objects.size).toBe(1);
      expect(await handleFileUploaded(uploaded(fileId), deps)).toEqual({ status: 'rejected' });
      expect(store.objects.size).toBe(0);
    });
  });

  it('skip an event for a file the worker cannot see', async () => {
    const store = memoryFileStore('test-bucket');
    expect(
      await handleFileUploaded(uploaded(newId()), { store, principal: worker, hosted: false }),
    ).toEqual({ status: 'skipped' });
  });
});

describe('the upload routes', () => {
  const deps = (principal: Principal | null = executive) => {
    const keyValue = memoryKeyValue();
    return {
      principal: () => Promise.resolve(principal ?? undefined),
      keyValue,
      presign: (p: Principal, input: never, call: never) =>
        presignUpload(p, input, call, request.store),
      complete: (p: Principal, fileId: string, input: { purpose: FilePurpose }, call: never) =>
        completeUploadFor(p, fileId, input.purpose, call, request.store),
      options: () => ({}),
      env: { BETTER_AUTH_URL: ORIGIN },
    };
  };
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    new Request(`${ORIGIN}/api/v1${path}`, {
      method: 'POST',
      headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const presignBody = {
    entityId: 1,
    purpose: 'signed_quote',
    name: 'Signed quote.pdf',
    contentType: 'application/pdf',
    size: 32,
    sha256: 'a'.repeat(64),
  };

  it('signs an upload for a signed-in person and answers the contract', async () => {
    const res = await presignRoute(post('/files/presign', presignBody), deps() as never);
    expect(res.status).toBe(200);
    const body = FilePresignResponse.parse(await res.json());
    const complete = await completeRoute(
      post(`/files/${body.fileId}/complete`, { purpose: 'signed_quote' }),
      { id: body.fileId },
      deps() as never,
    );
    expect(complete.status).toBe(409);
    expect(ErrorEnvelope.parse(await complete.json()).error.details).toEqual({
      reason: 'file_upload_mismatch',
    });
  });

  it('refuses another site, no session, a bad body and a bad key', async () => {
    const other = await presignRoute(
      post('/files/presign', presignBody, { origin: 'https://elsewhere.example' }),
      deps() as never,
    );
    expect(other.status).toBe(403);
    const nobody = await presignRoute(post('/files/presign', presignBody), deps(null) as never);
    expect(nobody.status).toBe(401);
    const bad = await presignRoute(
      post('/files/presign', { ...presignBody, size: 0 }),
      deps() as never,
    );
    expect(bad.status).toBe(400);
    const key = await presignRoute(
      post('/files/presign', presignBody, { 'idempotency-key': 'not a key' }),
      deps() as never,
    );
    expect(key.status).toBe(400);
    const missing = await completeRoute(
      post('/files/x/complete', { purpose: 'signed_quote' }),
      { id: 'x' },
      deps() as never,
    );
    expect(missing.status).toBe(404);
  });

  it('answers a refusal of the purpose as forbidden', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    const res = await presignRoute(post('/files/presign', presignBody), deps(caller) as never);
    expect(res.status).toBe(403);
  });

  it('caps the calls one person makes', async () => {
    const d = deps();
    let last: Response | undefined;
    for (let i = 0; i <= FILE_ROUTE_CAP.max; i += 1) {
      last = await presignRoute(post('/files/presign', { nothing: true }), d as never);
    }
    expect(last?.status).toBe(429);
  });
});
