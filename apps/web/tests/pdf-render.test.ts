import {
  ErrorEnvelope,
  newId,
  PdfRenderResult,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type DeliveredEvent,
  type PdfRenderJob,
  type Principal,
} from '@shakti/contracts';
import { closeOutboxDb } from '@shakti/db/outbox';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import {
  createLead,
  databaseAuditSink,
  databaseOutboxSink,
  envelopeCipher,
  localDiskFileStore,
  localKeyProvider,
  memoryKeyValue,
  runCommand,
  sha256Hex,
  updateEntity,
  uploadKey,
  type FieldCipher,
  type FileStore,
} from '@shakti/domain';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfOptions, PrintRenderer } from '../src/print/renderer';

// The render worker outside a Next.js request: the route, the loader, the commands and the
// database are real; Chromium is a stand-in that keeps the page it was given (the security suite
// runs where no browser is installed; the journeys print with the real one).
interface RenderState {
  store: FileStore | undefined;
  cipher: FieldCipher | undefined;
  pages: { html: string; options: PdfOptions | undefined }[];
  /** Chromium fails with the opened page in hand, after the loader read the account. */
  fail: boolean;
}
const state = vi.hoisted((): RenderState => ({
  store: undefined,
  cipher: undefined,
  pages: [],
  fail: false,
}));

/** A one-page PDF as Chromium writes its page objects. */
const PDF = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj << /Type /Pages /Count 1 >> endobj\n2 0 obj << /Type /Page >> endobj\n%%EOF\n',
);

vi.mock('../src/workers/pdf/deps', () => ({
  renderDeps: (principal: Principal, requestId: string) => {
    const renderer: PrintRenderer = {
      renderPdf: (html, options) => {
        if (state.fail) {
          return Promise.reject(
            new Error(`the page closed while printing ${html.length} characters`),
          );
        }
        state.pages.push({ html, options });
        return Promise.resolve(Buffer.from(PDF));
      },
      renderLabel: () => Promise.reject(new Error('no labels here')),
      renderImage: () => Promise.reject(new Error('no images here')),
      connected: () => true,
      close: () => Promise.resolve(),
    };
    if (state.store === undefined) throw new Error('no store');
    return {
      principal,
      requestId,
      store: state.store,
      cipher: state.cipher,
      renderer: () => Promise.resolve(renderer),
      hosted: false,
    };
  },
}));

const { POST } = await import('../src/app/api/v1/workers/pdf/render/route');
const { renderPdfJob } = await import('../src/workers/pdf/render-job');
const { renderDeps } = await import('../src/workers/pdf/deps');
const { deliverEvent } = await import('../src/workers/events/deliver');

// Low-entropy phrases, so the secret scan never mistakes them for real keys (CLAUDE.md).
const CURRENT_KEY = 'render-route-test-current-signing-key';
const APP = 'http://localhost:3000';
const ROUTE = `${APP}/api/v1/workers/pdf/render`;
const QSTASH_ENV = [
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'BETTER_AUTH_URL',
] as const;
const saved = new Map<string, string | undefined>();

/** The company printed here; the bank account suite uses another. */
const ENTITY = 4;
const ACCOUNT = {
  bankName: 'Punjab National Bank',
  accountNumber: '0461002100098273',
  ifsc: 'PUNB0046100',
  branch: 'Bikaner Main',
};

let dir: string;
let worker: Principal;
let savedBank: unknown;
let logoKey: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shakti-render-'));
  state.store = localDiskFileStore(dir, {
    signing: { secret: 'render suite signing phrase', url: (t) => `${APP}/files/${t}` },
  });
  const cipher = envelopeCipher(localKeyProvider(randomBytes(32).toString('base64')));
  state.cipher = cipher;
  worker = principalFor('system:workers', [ENTITY], { id: SYSTEM_WORKERS_PRINCIPAL_ID });

  const [row] = await asMigrator(
    (m) => m<{ bank: unknown }[]>`select bank_json as bank from entities where id = ${ENTITY}`,
  );
  savedBank = row?.bank ?? null;
  const executive = await createTestPrincipal('executive', [ENTITY]);
  await asPrincipal(executive, (context) =>
    runCommand(
      updateEntity,
      {
        context,
        audit: databaseAuditSink,
        outbox: databaseOutboxSink,
        fieldCipher: cipher,
      },
      { entityId: ENTITY, bankDetails: ACCOUNT },
    ),
  );

  // The company's current logo: a ready file whose bytes the store holds.
  const logo = await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 94, g: 106, b: 210 } },
  })
    .png()
    .toBuffer();
  const logoId = newId();
  logoKey = uploadKey(ENTITY, 'entity_logo', logoId, 'image/png');
  await state.store.put(logoKey, logo, 'image/png');
  await asMigrator(
    (
      m,
    ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
      values (${logoId}, ${ENTITY}, 'entity_logo', 'local', ${logoKey}, 'logo.png', 'image/png',
              ${logo.length}, ${sha256Hex(logo)}, 'ready', ${executive.id})`,
  );
});

afterAll(async () => {
  await asMigrator(
    (m) =>
      m`update entities set bank_json = ${savedBank === null ? null : m.json(savedBank as never)} where id = ${ENTITY}`,
  );
  await rm(dir, { recursive: true, force: true });
  await closeOutboxDb();
  await closeDb();
});

beforeEach(() => {
  for (const name of QSTASH_ENV) saved.set(name, process.env[name]);
  process.env.QSTASH_TOKEN = 'render-route-test-token';
  process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT_KEY;
  process.env.QSTASH_NEXT_SIGNING_KEY = 'render-route-test-next-signing-key';
  process.env.BETTER_AUTH_URL = APP;
  state.pages.length = 0;
  state.fail = false;
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

function proofJob(entityId = ENTITY): PdfRenderJob {
  return {
    eventId: newId(),
    entityId,
    target: {
      kind: 'document',
      documentType: 'company_letterhead_proof',
      documentId: newId(),
      version: 1,
    },
  };
}

function call(body: string, signature: string | null = sign(body)): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (signature !== null) headers.set('upstash-signature', signature);
  return POST(new Request(ROUTE, { method: 'POST', headers, body }));
}

async function fileRow(id: string) {
  const [row] = await asMigrator(
    (m) => m<{ purpose: string; status: string; key: string; size: number; sha256: string }[]>`
      select purpose, status, key, size, sha256 from files where id = ${id}`,
  );
  return row;
}

describe('POST /api/v1/workers/pdf/render (ADR 0009)', () => {
  it.each([
    ['no signature', null],
    ['a signature made with another key', 'key'],
    ['a signature for another address', 'address'],
    ['something that is not a signature', 'not-a-token'],
  ])('refuses a call with %s, so no person can call it, and renders nothing', async (_l, kind) => {
    const job = proofJob();
    const body = JSON.stringify(job);
    const signature =
      kind === null
        ? null
        : kind === 'key'
          ? sign(body, ROUTE, 'some-other-signing-key')
          : kind === 'address'
            ? sign(body, `${APP}/api/v1/workers/outbox/print.document.requested`)
            : kind;
    const response = await call(body, signature);
    expect(response.status).toBe(401);
    expect(ErrorEnvelope.parse(await response.json()).error.code).toBe('unauthorized');
    expect(state.pages).toEqual([]);
    expect(await fileRow(job.target.kind === 'document' ? job.target.documentId : '')).toBe(
      undefined,
    );
  });

  it('refuses a body over 24 KiB and a body that is not a job, for good', async () => {
    const big = JSON.stringify({ ...proofJob(), padding: 'x'.repeat(25 * 1024) });
    const large = await call(big);
    expect(large.status).toBe(400);
    expect(large.headers.get('upstash-nonretryable-error')).toBe('true');
    const wrong = JSON.stringify({ ...proofJob(), title: 'Proof page of Shakti Supreme' });
    const refused = await call(wrong);
    expect(refused.status).toBe(400);
    expect(refused.headers.get('upstash-nonretryable-error')).toBe('true');
  });

  it('refuses a sheet of labels and a document no loader prints, for good', async () => {
    const labels = JSON.stringify({
      eventId: newId(),
      entityId: ENTITY,
      target: { kind: 'labels', labelKind: 'serial', size: '50x25', ids: [newId()] },
    });
    const challan = JSON.stringify({
      ...proofJob(),
      target: {
        kind: 'document',
        documentType: 'delivery_challan',
        documentId: newId(),
        version: 1,
      },
    });
    for (const body of [labels, challan]) {
      const response = await call(body);
      expect(response.status).toBe(404);
      expect(response.headers.get('upstash-nonretryable-error')).toBe('true');
    }
    expect(state.pages).toEqual([]);
  });

  it('prints the proof page of the job’s company, stores and records it, once', async () => {
    const job = proofJob();
    if (job.target.kind !== 'document') throw new Error('a document job');
    const body = JSON.stringify(job);
    const response = await call(body);
    expect(response.status).toBe(200);
    const result = PdfRenderResult.parse(await response.json());
    expect(result).toEqual({
      eventId: job.eventId,
      outcome: 'done',
      fileId: job.target.documentId,
      pages: 1,
      bytes: PDF.length,
    });

    const row = await fileRow(job.target.documentId);
    expect(row).toEqual({
      purpose: 'print_proof',
      status: 'ready',
      key: uploadKey(ENTITY, 'print_proof', job.target.documentId, 'application/pdf'),
      size: PDF.length,
      sha256: sha256Hex(PDF),
    });
    expect(await state.store?.get(row?.key ?? '')).toEqual(PDF);

    // The page printed the company's own details, its logo and its account, opened.
    const [page] = state.pages;
    const [entity] = await asMigrator(
      (m) => m<{ legal: string }[]>`select legal_name as legal from entities where id = ${ENTITY}`,
    );
    expect(page?.html).toContain(entity?.legal ?? 'company');
    expect(page?.html).toContain('src="data:image/png;base64,');
    for (const value of [ACCOUNT.bankName, ACCOUNT.accountNumber, ACCOUNT.ifsc, ACCOUNT.branch]) {
      expect(page?.html).toContain(value);
    }
    const others = await asMigrator(
      (m) => m<{ legal: string }[]>`select legal_name as legal from entities where id <> ${ENTITY}`,
    );
    for (const other of others) expect(page?.html).not.toContain(other.legal);
    expect(page?.options).toMatchObject({ format: 'A4' });

    // QStash delivering the same job again renders nothing more.
    const again = await call(body);
    expect(PdfRenderResult.parse(await again.json())).toEqual({
      eventId: job.eventId,
      outcome: 'duplicate',
    });
    expect(state.pages).toHaveLength(1);
  });

  it('answers the recorded file when a job whose id was lost runs again, rendering nothing', async () => {
    const job = proofJob();
    if (job.target.kind !== 'document') throw new Error('a document job');
    const first = await renderPdfJob(job, renderDeps(worker, newId()));
    const second = await renderPdfJob(job, renderDeps(worker, newId()));
    expect(second).toEqual(first);
    expect(state.pages).toHaveLength(1);
  });
});

/**
 * A quote of the printed company, written as the table owner with fixed synthetic amounts (the
 * commands that price it are tested in packages/domain): a lead of a fresh customer, its site in
 * Gujarat, one line taxed at its own rate and the inter-state total.
 */
async function quoteFixture(): Promise<{ quoteId: string; quoteNo: string; phone: string }> {
  const executive = await createTestPrincipal('executive', [ENTITY]);
  const phone = `95${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const lead = await asPrincipal(executive, (context) =>
    runCommand(
      createLead,
      { context, audit: databaseAuditSink, outbox: databaseOutboxSink },
      {
        entityId: ENTITY,
        pipelineKey: 'residential_rooftop',
        contact: { name: 'Render test customer', phone },
        account: { type: 'household' },
        site: { type: 'rooftop', village: 'Render test village', pin: '380001' },
      },
    ),
  );
  const quoteId = newId();
  const quoteNo = `RT/Q/2098-99/${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
  const ids = { list: newId(), item: newId(), rate: newId() };
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`update customer_sites set state_code = '24', district = 'Ahmedabad'
               where id = (select site_id from opportunities where id = ${lead.id})`;
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at)
               values (${ids.list}, (select id from price_tiers where code = 'retail'), ${ENTITY},
                       ${9200 + Math.floor(Math.random() * 1e5)}, '2090-01-01', now())`;
      await tx`insert into items (id, sku, name, category, hsn) values
               (${ids.item}, ${`RT-${ids.item}`}, 'render test module', 'solar_module', '8541')`;
      await tx`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref)
               values (${ids.rate}, ${ids.item}, 12.00, '2090-01-01', 'render test')`;
      await tx`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, site_id,
                 tier_id, price_list_id, scheme, place_of_supply_state, supply_kind, valid_until,
                 subtotal, cgst, sgst, igst, tax_total, round_off, grand_total, created_by)
               select ${quoteId}, ${ENTITY}, ${quoteNo}, '2098-99', o.id, o.account_id, o.site_id,
                      (select id from price_tiers where code = 'retail'), ${ids.list}, 'none', '24',
                      'inter', '2026-10-20T18:29:59.999Z', 60000.00, 0, 0, 7200.00, 7200.00, 0,
                      67200.00, ${executive.id}
                 from opportunities o where o.id = ${lead.id}`;
      await tx`insert into quote_lines (id, entity_id, quote_id, position, item_id, sku, description,
                 unit, qty, unit_price, hsn, tax_rate_id, tax_rate_pct, taxable_value, cgst, sgst,
                 igst, line_total)
               values (${newId()}, ${ENTITY}, ${quoteId}, 1, ${ids.item}, ${`RT-${ids.item}`},
                       'render test module', 'nos', 5, 12000.00, '8541', ${ids.rate}, 12.00,
                       60000.00, 0, 0, 7200.00, 67200.00)`;
    }),
  );
  return { quoteId, quoteNo, phone };
}

function quoteJob(quoteId: string): PdfRenderJob {
  return {
    eventId: newId(),
    entityId: ENTITY,
    target: { kind: 'document', documentType: 'quote', documentId: quoteId, version: 1 },
  };
}

describe('printing a quote (docs/design/phase1.md §7.3)', () => {
  it('prints the quote from its loader, records the PDF and attaches it to the quote, once', async () => {
    const { quoteId, quoteNo, phone } = await quoteFixture();
    const job = quoteJob(quoteId);
    const result = await renderPdfJob(job, renderDeps(worker, newId()));
    expect(result).toMatchObject({ fileId: job.eventId, pages: 1 });
    expect(await fileRow(job.eventId)).toMatchObject({ purpose: 'quote_pdf', status: 'ready' });
    const [quote] = await asMigrator(
      (m) =>
        m<{ pdf: string | null }[]>`select pdf_file_id as pdf from quotes where id = ${quoteId}`,
    );
    expect(quote?.pdf).toBe(job.eventId);

    const [page] = state.pages;
    for (const text of [
      quoteNo,
      'Render test customer',
      'Gujarat (24)',
      'Ahmedabad',
      'IGST',
      '67,200.00',
      'Rupees Sixty Seven Thousand Two Hundred only',
      'Prices and taxes on this quotation hold until 20-10-2026.',
    ]) {
      expect(page?.html).toContain(text);
    }
    // No phone number of the customer, no CGST row for an inter-state supply, no QR code.
    expect(page?.html).not.toContain(phone.slice(-5));
    expect(page?.html).not.toContain('CGST');
    expect(page?.html).not.toContain('class="qr"');

    // The same job again: the file stands, the attach changes nothing.
    await renderPdfJob(job, renderDeps(worker, newId()));
    expect(state.pages).toHaveLength(1);
  });

  it('prints nothing for a quote of another company', async () => {
    await expect(
      renderPdfJob({ ...quoteJob(newId()) }, renderDeps(worker, newId())),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(state.pages).toEqual([]);
  });
});

describe('the render path’s log lines (docs/SECURITY.md §7)', () => {
  it('carry no part of the bank account, when a print succeeds or fails after opening it', async () => {
    const { logger } = await import('../src/log');
    const lines: string[] = [];
    const spy = vi.spyOn(logger, 'log').mockImplementation((level, event, fields) => {
      lines.push(
        JSON.stringify({ level, event, fields }, (_key, value: unknown) =>
          value instanceof Error ? { message: value.message, stack: value.stack } : value,
        ),
      );
    });
    try {
      expect((await call(JSON.stringify(proofJob()))).status).toBe(200);
      state.fail = true;
      const failed = await call(JSON.stringify(proofJob()));
      expect(failed.status).toBeGreaterThanOrEqual(500);
    } finally {
      spy.mockRestore();
    }
    const events = lines.map((line) => (JSON.parse(line) as { event: string }).event);
    expect(events).toEqual(expect.arrayContaining(['print.rendered', 'print.job_failed']));
    for (const value of [ACCOUNT.bankName, ACCOUNT.accountNumber, ACCOUNT.ifsc, ACCOUNT.branch]) {
      for (const line of lines) expect(line).not.toContain(value);
    }
  });
});

describe('renderPdfJob: who may print (docs/SECURITY.md §8)', () => {
  it('stores nothing for a principal without files.process, even an Executive', async () => {
    const job = proofJob();
    if (job.target.kind !== 'document') throw new Error('a document job');
    for (const principal of [
      await createTestPrincipal('executive', [ENTITY]),
      principalFor('general_manager', [ENTITY]),
      principalFor('agent:triage', [ENTITY]),
    ]) {
      await expect(renderPdfJob(job, renderDeps(principal, newId()))).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
    expect(await fileRow(job.target.documentId)).toBeUndefined();
    expect(state.pages).toEqual([]);
    const key = uploadKey(ENTITY, 'print_proof', job.target.documentId, 'application/pdf');
    expect(await state.store?.get(key)).toBeUndefined();
  });

  it('refuses a job of another company than the worker’s, and a worker of several', async () => {
    await expect(renderPdfJob(proofJob(1), renderDeps(worker, newId()))).rejects.toMatchObject({
      code: 'forbidden',
    });
    const wide = principalFor('system:workers', [1, ENTITY], { id: SYSTEM_WORKERS_PRINCIPAL_ID });
    await expect(renderPdfJob(proofJob(), renderDeps(wide, newId()))).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(state.pages).toEqual([]);
  });

  it('is unavailable without a field cipher when the company has an account, storing nothing', async () => {
    const job = proofJob();
    if (job.target.kind !== 'document') throw new Error('a document job');
    const cipher = state.cipher;
    state.cipher = undefined;
    try {
      await expect(renderPdfJob(job, renderDeps(worker, newId()))).rejects.toMatchObject({
        code: 'integration_unavailable',
      });
    } finally {
      state.cipher = cipher;
    }
    expect(await fileRow(job.target.documentId)).toBeUndefined();
  });
});

describe('without a queue, the event is printed in the process that committed it', () => {
  it('delivers print.document.requested to the registered worker as the system principal', async () => {
    const documentId = newId();
    const event: DeliveredEvent = {
      id: newId(),
      sequence: '1',
      type: 'print.document.requested',
      entityId: ENTITY,
      aggregateType: 'print_proof',
      aggregateId: documentId,
      payload: {
        documentType: 'company_letterhead_proof',
        documentId,
        version: 1,
        v: 1,
      },
    };
    const result = await deliverEvent(event, { keyValue: memoryKeyValue(), requestId: newId() });
    expect(result).toEqual({ eventId: event.id, outcome: 'done' });
    expect(await fileRow(documentId)).toMatchObject({ purpose: 'print_proof', status: 'ready' });
  });
});
