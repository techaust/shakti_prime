import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type DeliveredEvent,
  type DocumentDto,
  type Principal,
  type UploadSlotDto,
} from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { closeOutboxDb } from '@shakti/db/outbox';
import {
  beginUpload,
  completeUpload,
  executeCommand,
  fileDocument,
  memoryFileStore,
  memoryLogger,
  sha256Hex,
} from '@shakti/domain';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { DocumentMasker } from '../src/workers/ocr/mask-document';
import { AADHAAR, AADHAAR_SPACED, coveringMasker, pdfOf, scanOf } from './support/pdf-fixtures';

// SECURITY §11 items 7 and 8 for the J3 customer documents (docs/03-roadmap-appendix/phase4.md
// §6.3): generated photos and scans carrying a twelve-digit number go through the upload, the
// file checks and the filing as a person does them, and the number's digits but its last four are
// then nowhere: not in the store's keys or kept bytes, a row, an audit value, an event, a log line
// or an error report. J3 makes no model call; what J7's classifier will be sent is the masked copy
// read back here. Every number is made up. The real masking step needs the English OCR model
// (`OCR_LANG_PATH`, which CI fetches); without it the generated-document cases are skipped.

const sentry = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('@sentry/nextjs', () => {
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      sentry.calls.push([name, ...args]);
      return undefined;
    };
  const scope = {
    setLevel: record('setLevel'),
    setFingerprint: record('setFingerprint'),
    setTag: record('setTag'),
    setExtras: record('setExtras'),
  };
  return {
    captureException: record('captureException'),
    captureMessage: record('captureMessage'),
    flush: () => Promise.resolve(true),
    withScope: (run: (s: typeof scope) => void) => {
      run(scope);
    },
  };
});

const { handleFileUploaded } = await import('../src/workers/files/handle-file-uploaded');
const { vaultMasker } = await import('../src/workers/ocr/vault-masker');
const { renderMaskedPages } = await import('../src/workers/files/pdf-pages');

const realOcr = (process.env.OCR_LANG_PATH ?? '') !== '';

/** Every way the hidden digits could be written: whole, spaced, or its first eight together. */
const HIDDEN = [AADHAAR, AADHAAR_SPACED, AADHAAR.slice(0, 8), AADHAAR_SPACED.slice(0, 9)];
const LAST_FOUR = AADHAAR.slice(8);

const store = memoryFileStore('memory');
const workers = principalFor('system:workers', [1], { id: SYSTEM_WORKERS_PRINCIPAL_ID });
const logs = memoryLogger();
const printed: string[] = [];
let manager: Principal;
let customer: string;
let otherCustomer: string;

beforeAll(async () => {
  vi.stubEnv('SENTRY_DSN', 'https://publickey@o4501.ingest.us.sentry.io/4502');
  // Every line the application prints, the JSON logger's included.
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      printed.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
  }
  manager = await createTestPrincipal('project_manager', [1]);
  customer = newId();
  otherCustomer = newId();
  await asMigrator(async (m) => {
    await m`insert into accounts (id, type, name, created_by) values
      (${customer}, 'household', 'masking check customer', ${manager.id}),
      (${otherCustomer}, 'household', 'masking check other customer', ${manager.id})`;
    await m`insert into account_entities (id, account_id, entity_id, owner_id, created_by) values
      (${newId()}, ${customer}, 1, ${manager.id}, ${manager.id}),
      (${newId()}, ${otherCustomer}, 1, ${manager.id}, ${manager.id})`;
  });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await closeOutboxDb();
  await closeDb();
});

const options = { hosted: false, logger: logs };

/** The Project Manager's upload of `bytes` for `account`, as the Documents tab makes it. */
async function upload(
  bytes: Uint8Array,
  contentType: 'image/jpeg' | 'application/pdf',
  name: string,
  account = customer,
): Promise<UploadSlotDto> {
  const slot = await executeCommand(
    manager,
    { entityIds: [1] },
    beginUpload,
    {
      entityId: 1,
      purpose: 'customer_document',
      name,
      contentType,
      size: bytes.length,
      sha256: sha256Hex(bytes),
      bucket: 'memory',
      accountId: account,
    },
    options,
  );
  await store.put(slot.key, bytes, contentType);
  await executeCommand(
    manager,
    { entityIds: [1] },
    completeUpload,
    {
      fileId: slot.fileId,
      purpose: 'customer_document',
      stored: { size: bytes.length, sha256: sha256Hex(bytes) },
    },
    options,
  );
  return slot;
}

/** The file checks, delivered until they finish, as the event worker runs them. */
async function checks(fileId: string, masker: () => Promise<DocumentMasker>) {
  let payload: DeliveredEvent['payload'] = { purpose: 'customer_document', v: 1 };
  for (let delivery = 0; delivery < 20; delivery += 1) {
    const outcome = await handleFileUploaded(
      {
        id: newId(),
        sequence: '1',
        type: 'files.file.uploaded',
        entityId: 1,
        aggregateType: 'file',
        aggregateId: fileId,
        payload,
      },
      { store, principal: workers, hosted: false, masker, logger: logs },
    );
    if (outcome.status !== 'masking') return outcome;
    payload = { purpose: 'customer_document', maskedPages: outcome.maskedPages, v: 1 };
  }
  throw new Error('the checks did not finish');
}

function file(fileId: string, kind: 'identity_proof' | 'electricity_bill', account = customer) {
  return executeCommand(
    manager,
    { entityIds: [1] },
    fileDocument,
    { entityId: 1, accountId: account, fileId, kind, requirementKey: kind },
    options,
  ) as Promise<DocumentDto>;
}

/** The digits OCR reads off a kept picture: what a model would be shown of it. */
async function digitsOn(jpeg: Uint8Array): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const reader = await createWorker('eng', 1, {
    langPath: process.env.OCR_LANG_PATH ?? '',
    cacheMethod: 'none',
    gzip: true,
  });
  try {
    const { data } = await reader.recognize(Buffer.from(jpeg));
    return data.text.replace(/\D/g, '');
  } finally {
    await reader.terminate();
  }
}

/** Every row, audit value, event, log line and error report about `ids`, as one text. */
async function everythingAbout(ids: readonly string[]): Promise<string> {
  const rows = await asMigrator(async (m) => [
    ...(await m`select to_jsonb(f)::text as t from files f where id = any(${ids}::uuid[])`),
    ...(await m`select to_jsonb(d)::text as t from documents d where id = any(${ids}::uuid[])
                                                             or file_id = any(${ids}::uuid[])`),
    ...(await m`select to_jsonb(i)::text as t from identity_documents i
                 where masked_file_id = any(${ids}::uuid[])`),
    ...(await m`select to_jsonb(a)::text as t from audit_logs a
                 where aggregate_id = any(${ids}::text[])
                    or input_json::text like any(${ids.map((id) => `%${id}%`)}::text[])`),
  ]);
  const events = await asOutboxPublisher(
    (p) => p`select to_jsonb(o)::text as t from outbox_events o
              where aggregate_id = any(${ids}::text[])`,
  );
  return [
    ...rows.map((r) => String(r.t)),
    ...events.map((r) => String(r.t)),
    ...logs.entries.map((e) => JSON.stringify(e)),
    ...printed,
    JSON.stringify(sentry.calls),
    [...store.objects.keys()].join('\n'),
  ].join('\n');
}

function expectNoHiddenDigits(text: string) {
  for (const hidden of HIDDEN) expect(text).not.toContain(hidden);
}

describe.skipIf(!realOcr)('an identity number on a customer document (SECURITY §11 item 8)', () => {
  it('keeps a photo of an identity paper only masked, with its last four digits', async () => {
    const [photo] = await renderMaskedPages(await pdfOf([`Aadhaar No ${AADHAAR_SPACED}`]));
    if (photo === undefined) throw new Error('no photo');
    const slot = await upload(photo, 'image/jpeg', `aadhaar ${AADHAAR_SPACED}.jpg`);
    expect(await checks(slot.fileId, vaultMasker)).toEqual({ status: 'ready' });

    // The upload's own bytes are gone; the one picture kept reads no number but its last four.
    expect(store.objects.has(slot.key)).toBe(false);
    const kept = [...store.objects.entries()].filter(([key]) => key.includes(slot.fileId));
    expect(kept).toHaveLength(1);
    const digits = await digitsOn(kept[0]?.[1].bytes ?? new Uint8Array());
    expect(digits).not.toContain(AADHAAR.slice(0, 8));
    expect(digits).not.toContain(AADHAAR.slice(4, 12));

    const document = await file(slot.fileId, 'identity_proof');
    expect(document).toMatchObject({
      sensitive: true,
      lastFour: [{ kind: 'aadhaar', lastFour: LAST_FOUR }],
    });
    expectNoHiddenDigits(await everythingAbout([slot.fileId, document.id]));
  }, 180_000);

  it('keeps a scanned PDF of an identity paper only as its masked pages', async () => {
    const scan = await scanOf(`Aadhaar No ${AADHAAR_SPACED}`);
    const slot = await upload(scan, 'application/pdf', 'KYC scan.pdf');
    expect(await checks(slot.fileId, vaultMasker)).toEqual({ status: 'ready' });

    expect(store.objects.has(slot.key)).toBe(false);
    const kept = [...store.objects.entries()].filter(([key]) => key.includes(slot.fileId));
    expect(kept.map(([key]) => key)).toEqual([expect.stringMatching(/-checked\.pdf$/)]);
    const [page] = await renderMaskedPages(kept[0]?.[1].bytes ?? new Uint8Array());
    const digits = await digitsOn(page ?? new Uint8Array());
    expect(digits).not.toContain(AADHAAR.slice(0, 8));
    expect(digits).not.toContain(AADHAAR.slice(4, 12));

    const document = await file(slot.fileId, 'identity_proof');
    expect(document.lastFour).toEqual([{ kind: 'aadhaar', lastFour: LAST_FOUR }]);
    expectNoHiddenDigits(await everythingAbout([slot.fileId, document.id]));
  }, 180_000);
});

describe('a customer document is filed against its own customer only (SECURITY §11 item 7)', () => {
  it('refuses the file to another customer and writes nothing, then files it to its own', async () => {
    const [photo] = await renderMaskedPages(await pdfOf(['Electricity bill']));
    if (photo === undefined) throw new Error('no photo');
    const slot = await upload(photo, 'image/jpeg', 'bill.jpg');
    expect(await checks(slot.fileId, () => Promise.resolve(coveringMasker()))).toEqual({
      status: 'ready',
    });
    await expect(file(slot.fileId, 'electricity_bill', otherCustomer)).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'file_customer_mismatch' },
    });
    const [none] = await asMigrator(
      (m) =>
        m<{ n: number }[]>`select count(*)::int as n from documents where file_id = ${slot.fileId}`,
    );
    expect(none?.n).toBe(0);
    expect(await file(slot.fileId, 'electricity_bill')).toMatchObject({
      accountId: customer,
      sensitive: false,
    });
  });

  it('refuses an upload for a customer the company does not know', async () => {
    const stranger = newId();
    await asMigrator(
      (m) => m`insert into accounts (id, type, name, created_by)
        values (${stranger}, 'household', 'masking check stranger', ${manager.id})`,
    );
    await expect(
      upload(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg', 'paper.jpg', stranger),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a customer document where no masking step is set up, and keeps nothing', async () => {
    const slot = await upload(await pdfOf(['One page']), 'application/pdf', 'paper.pdf');
    const outcome = await handleFileUploaded(
      {
        id: newId(),
        sequence: '1',
        type: 'files.file.uploaded',
        entityId: 1,
        aggregateType: 'file',
        aggregateId: slot.fileId,
        payload: { purpose: 'customer_document', v: 1 },
      },
      { store, principal: workers, hosted: false, logger: logs },
    );
    expect(outcome).toEqual({ status: 'rejected' });
    expect(store.objects.has(slot.key)).toBe(false);
  });
});
