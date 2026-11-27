import {
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
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestUser,
  principalFor,
} from '@shakti/db/testing';
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  databaseAuditSink,
  databaseOutboxSink,
  executeQuery,
  getFile,
  localDiskFileStore,
  memoryKeyValue,
  purchaseOrderPdfFileId,
  runCommand,
  sendPurchaseOrder,
  uploadKey,
  type AnyCommand,
  type FileStore,
  type MailMessage,
} from '@shakti/domain';
import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../messages/en.json';
import type { PrintRenderer } from '../src/print/renderer';

// U2's purchase order PDF through the render worker (ADR 0009, review R2): the render route, the
// loader, the commands, the mail step's reads and the database are real; Chromium is a stand-in
// that keeps the page it was given, and the mailer is in memory (the security suite runs where no
// browser is installed; `e2e/purchase-orders.spec.ts` downloads the PDF the real one printed).
interface RenderState {
  store: FileStore | undefined;
  pages: string[];
  mails: MailMessage[];
  principal: Principal | undefined;
}
const state = vi.hoisted((): RenderState => ({
  store: undefined,
  pages: [],
  mails: [],
  principal: undefined,
}));

/** A PDF of one page as Chromium writes its page objects. */
const PDF = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj << /Type /Pages /Count 1 >> endobj\n2 0 obj << /Type /Page >> endobj\n%%EOF\n',
);

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () => Promise.resolve({ get: () => undefined, set: () => undefined }),
}));
vi.mock('../src/auth/current-principal', () => ({
  currentPrincipal: () => Promise.resolve(state.principal),
  currentPrincipalQuietly: () => Promise.resolve(state.principal),
}));
vi.mock('../src/files/store', () => ({
  fileStore: () => state.store,
  localFilesSecret: () => 'purchase order suite signing phrase',
}));
vi.mock('../src/workers/pdf/deps', async () => {
  const { purchaseOrderMailDeps } = await import('../src/workers/procurement-mail');
  return {
    renderDeps: (principal: Principal, requestId: string) => {
      const renderer: PrintRenderer = {
        renderPdf: (html) => {
          state.pages.push(html);
          return Promise.resolve(Buffer.from(PDF));
        },
        renderLabel: () => Promise.reject(new Error('no labels here')),
        renderImage: () => Promise.reject(new Error('no images here')),
        connected: () => true,
        close: () => Promise.resolve(),
      };
      const store = state.store;
      if (store === undefined) throw new Error('no store');
      const mailer = {
        send: (message: MailMessage) => {
          state.mails.push(message);
          return Promise.resolve();
        },
      };
      return {
        principal,
        requestId,
        store,
        cipher: undefined,
        renderer: () => Promise.resolve(renderer),
        hosted: false,
        // The worker's own mail reads, with the mailer in memory.
        mail: { ...purchaseOrderMailDeps(principal, requestId, store), mailer },
      };
    },
  };
});

const { POST } = await import('../src/app/api/v1/workers/pdf/render/route');
const { GET } = await import('../src/app/(bos)/procurement/orders/[id]/pdf/route');
const { renderPdfJob } = await import('../src/workers/pdf/render-job');
const { renderDeps } = await import('../src/workers/pdf/deps');
const { purchaseOrderSentJobOf, renderJobOf } = await import('../src/workers/pdf/job');
const { deliverEvent } = await import('../src/workers/events/deliver');

// Low-entropy phrases, so the secret scan never mistakes them for real keys (CLAUDE.md).
const CURRENT_KEY = 'purchase-order-route-test-current-signing-key';
const APP = 'http://localhost:3000';
const ROUTE = `${APP}/api/v1/workers/pdf/render`;
const QSTASH_ENV = [
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'BETTER_AUTH_URL',
] as const;
const saved = new Map<string, string | undefined>();

/** The company whose orders are printed here. */
const ENTITY = 2;

let dir: string;
let worker: Principal;
let manager: Principal; // drafts
let checker: Principal; // approves another's drafts
let buyer: { id: string; email: string };
let buyerAsPrincipal: Principal;
const tag = newId().slice(-8).toUpperCase();
const f = { hub: newId(), item: newId(), vendor: newId(), contact: newId() };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shakti-po-pdf-'));
  state.store = localDiskFileStore(dir, {
    signing: { secret: 'purchase order suite signing phrase', url: (t) => `${APP}/files/${t}` },
  });
  worker = principalFor('system:workers', [ENTITY], { id: SYSTEM_WORKERS_PRINCIPAL_ID });
  manager = await createTestPrincipal('inventory_manager', [ENTITY]);
  checker = await createTestPrincipal('inventory_manager', [ENTITY]);
  buyer = await createTestUser([{ entityId: ENTITY, roleKey: 'inventory_manager' }]);
  buyerAsPrincipal = principalFor('inventory_manager', [ENTITY], { id: buyer.id });
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
        values (${f.hub}, ${`P${tag}`}, ${`PO print hub ${tag}`}, 'godown', '08', '302001', ${manager.id})`;
      await tx`insert into vendors (id, name, state_code, created_by)
        values (${f.vendor}, ${`PO print vendor ${tag}`}, '08', ${manager.id})`;
      await tx`insert into vendor_contacts (id, vendor_id, name, email, position, created_by)
        values (${f.contact}, ${f.vendor}, 'Sales desk', 'sales@vendor.example.in', 1, ${manager.id})`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_active)
        values (${f.item}, ${`POP-${tag}`}, ${`PO print cable ${tag}`}, 'cable', '8544', 'metre', true)`;
      await tx`insert into tax_rates (id, item_id, rate_pct, effective_from)
        values (${newId()}, ${f.item}, 18, '2020-01-01')`;
      await tx`insert into item_vendors (id, item_id, vendor_id, is_preferred, created_by)
        values (${newId()}, ${f.item}, ${f.vendor}, true, ${manager.id})`;
    }),
  );
});

afterAll(async () => {
  await asMigrator(
    (m) => m`update items set archived_at = coalesce(archived_at, now()), is_active = false
               where id = ${f.item}`,
  );
  await rm(dir, { recursive: true, force: true });
  await closeOutboxDb();
  await closeDb();
});

beforeEach(() => {
  for (const name of QSTASH_ENV) saved.set(name, process.env[name]);
  process.env.QSTASH_TOKEN = 'purchase-order-route-test-token';
  process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT_KEY;
  process.env.QSTASH_NEXT_SIGNING_KEY = 'purchase-order-route-test-next-signing-key';
  process.env.BETTER_AUTH_URL = APP;
  state.pages.length = 0;
  state.mails.length = 0;
  state.principal = undefined;
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
});

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

/** A signature as QStash makes it: an HS256 token naming the address and the body's hash. */
function sign(body: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: 'Upstash',
      sub: ROUTE,
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

function call(job: PdfRenderJob): Promise<Response> {
  const body = JSON.stringify(job);
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set('upstash-signature', sign(body));
  return POST(new Request(ROUTE, { method: 'POST', headers, body }));
}

/** The order's PDF as a person asks for it at its address. */
function download(who: Principal | undefined, orderId: string, query = ''): Promise<Response> {
  state.principal = who;
  return GET(new Request(`${APP}/procurement/orders/${orderId}/pdf${query}`), {
    params: Promise.resolve({ id: orderId }),
  });
}

function run<T>(who: Principal, command: AnyCommand, input: unknown): Promise<T> {
  return asPrincipal(who, (context) =>
    runCommand(command, { context, audit: databaseAuditSink, outbox: databaseOutboxSink }, input),
  ) as Promise<T>;
}

interface Ref {
  id: string;
  poNo: string;
}

/** A draft of 10 metres at ₹100 within Rajasthan, to the vendor, for the hub. */
function draft(): Promise<Ref> {
  return run<Ref>(manager, createPurchaseOrder, {
    entityId: ENTITY,
    vendorId: f.vendor,
    deliverToWarehouseId: f.hub,
    lines: [{ itemId: f.item, qty: '10', rate: '100' }],
  });
}

async function approved(): Promise<Ref> {
  const po = await draft();
  await run(checker, approvePurchaseOrder, { purchaseOrderId: po.id });
  return po;
}

/** The order's latest event of `type`, as the outbox delivers it. */
async function eventOf(orderId: string, type: string): Promise<DeliveredEvent> {
  const [row] = await asOutboxPublisher(
    (m) => m<{ id: string; sequence: string; payload_json: Record<string, unknown> }[]>`
      select id, sequence::text, payload_json from outbox_events
       where aggregate_id = ${orderId} and type = ${type}
       order by sequence desc limit 1`,
  );
  if (row === undefined) throw new Error(`no ${type} event`);
  return {
    id: row.id,
    sequence: row.sequence,
    type,
    entityId: ENTITY,
    aggregateType: 'purchase_order',
    aggregateId: orderId,
    payload: { ...row.payload_json, v: 1 },
  } as DeliveredEvent;
}

async function fileRow(id: string) {
  const [row] = await asMigrator(
    (m) => m<{ purpose: string; status: string; key: string; name: string }[]>`
      select purpose, status, key, name from files where id = ${id}`,
  );
  return row;
}

describe('a purchase order’s PDF through the render route', () => {
  it('prints an approved order with its rates on approval, stores it under its version, once', async () => {
    const po = await approved();
    const job = renderJobOf(await eventOf(po.id, 'print.document.requested'));
    expect(job.target).toEqual({
      kind: 'document',
      documentType: 'purchase_order',
      documentId: po.id,
      version: 1,
    });
    const fileId = purchaseOrderPdfFileId(po.id, 1);
    const response = await call(job);
    expect(response.status).toBe(200);
    expect(PdfRenderResult.parse(await response.json())).toEqual({
      eventId: job.eventId,
      outcome: 'done',
      fileId,
      pages: 1,
      bytes: PDF.length,
    });
    expect(await fileRow(fileId)).toEqual({
      purpose: 'purchase_order_pdf',
      status: 'ready',
      key: uploadKey(ENTITY, 'purchase_order_pdf', fileId, 'application/pdf'),
      name: `Purchase order ${po.poNo.replaceAll('/', '-')}.pdf`,
    });
    // The vendor's copy: its number, the vendor, the rate and the amounts with GST.
    const [page] = state.pages;
    expect(page).toContain(po.poNo);
    expect(page).toContain(`PO print vendor ${tag}`);
    expect(page).toContain('100.00');
    expect(page).toContain('1,000.00');
    expect(page).not.toContain('class="cancelled"');

    expect(PdfRenderResult.parse(await (await call(job)).json())).toEqual({
      eventId: job.eventId,
      outcome: 'duplicate',
    });
    // Another request for the same version finds the stored file and prints nothing again.
    const again = await call({ ...job, eventId: newId() });
    expect(PdfRenderResult.parse(await again.json())).toMatchObject({ outcome: 'done', fileId });
    expect(state.pages).toHaveLength(1);
  });

  it('prints a cancelled order’s own version, marked cancelled', async () => {
    const po = await approved();
    await call(renderJobOf(await eventOf(po.id, 'print.document.requested')));
    await run(manager, cancelPurchaseOrder, { purchaseOrderId: po.id, reason: 'Ordered twice' });
    const job = renderJobOf(await eventOf(po.id, 'print.document.requested'));
    expect(job.target).toMatchObject({ documentId: po.id, version: 2 });
    expect(PdfRenderResult.parse(await (await call(job)).json())).toMatchObject({
      outcome: 'done',
      fileId: purchaseOrderPdfFileId(po.id, 2),
    });
    expect(state.pages[0]).not.toContain('class="cancelled"');
    expect(state.pages[1]).toContain('class="cancelled"');
  });

  it('refuses, for good, a draft’s PDF and a version the order does not print', async () => {
    const po = await draft();
    for (const version of [1, 2]) {
      const job: PdfRenderJob = {
        eventId: newId(),
        entityId: ENTITY,
        target: { kind: 'document', documentType: 'purchase_order', documentId: po.id, version },
      };
      const response = await call(job);
      expect(response.status).toBe(404);
      expect(response.headers.get('upstash-nonretryable-error')).toBe('true');
    }
    expect(state.pages).toEqual([]);
    expect(await fileRow(purchaseOrderPdfFileId(po.id, 1))).toBeUndefined();
  });

  it('stores nothing for a principal without files.process, even the Executive', async () => {
    const po = await approved();
    const executive = await createTestPrincipal('executive', [ENTITY]);
    const job = renderJobOf(await eventOf(po.id, 'print.document.requested'));
    await expect(renderPdfJob(job, renderDeps(executive, newId()))).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(state.pages).toEqual([]);
  });
});

describe('the order’s PDF a person downloads', () => {
  it('serves the stored file to a rate reader, and says it is being prepared before', async () => {
    const po = await approved();
    const before = await download(manager, po.id);
    expect(before.status).toBe(503);
    expect(before.headers.get('refresh')).toBe('5');
    expect(await before.text()).toBe(en.procurement.orderPdf.preparing);

    await renderPdfJob(
      renderJobOf(await eventOf(po.id, 'print.document.requested')),
      renderDeps(worker, newId()),
    );
    const served = await download(manager, po.id);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('application/pdf');
    expect(served.headers.get('content-disposition')).toBe(
      `inline; filename="Purchase order ${po.poNo.replaceAll('/', '-')}.pdf"`,
    );
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PDF);
    expect(
      (await download(manager, po.id, '?download=1')).headers.get('content-disposition'),
    ).toMatch(/^attachment; /);
    // Nothing was printed for the person's request.
    expect(state.pages).toHaveLength(1);
  });

  it('answers not found to whoever reads no rate, another company, and for a draft', async () => {
    const po = await approved();
    await renderPdfJob(
      renderJobOf(await eventOf(po.id, 'print.document.requested')),
      renderDeps(worker, newId()),
    );
    for (const role of ['general_manager', 'store_manager'] as const) {
      const who = await createTestPrincipal(role, [ENTITY]);
      expect((await download(who, po.id)).status, role).toBe(404);
      // The stored file itself is hidden from them too.
      expect(
        await executeQuery(who, {}, (ctx) => getFile(ctx, purchaseOrderPdfFileId(po.id, 1)), {
          name: 'purchase-orders.test',
        }),
        role,
      ).toBeUndefined();
    }
    const elsewhere = await createTestPrincipal('inventory_manager', [3]);
    expect((await download(elsewhere, po.id)).status).toBe(404);
    expect((await download(manager, (await draft()).id)).status).toBe(404);
    expect((await download(undefined, po.id)).status).toBe(401);
  });
});

describe('a purchase order sent, through the render route', () => {
  async function sentVia(via: 'email' | 'by_hand'): Promise<{ po: Ref; event: DeliveredEvent }> {
    const po = await approved();
    await run(buyerAsPrincipal, sendPurchaseOrder, {
      purchaseOrderId: po.id,
      via,
      ...(via === 'email' ? { vendorContactId: f.contact } : {}),
    });
    return { po, event: await eventOf(po.id, 'procurement.po.sent') };
  }

  it('by email: prints the PDF as approved and mails the stored file to the vendor’s person, once', async () => {
    const { po, event } = await sentVia('email');
    const job = purchaseOrderSentJobOf(event);
    const response = await call(job);
    expect(PdfRenderResult.parse(await response.json())).toMatchObject({
      eventId: event.id,
      outcome: 'done',
      fileId: purchaseOrderPdfFileId(po.id, 1),
    });
    expect(state.mails).toHaveLength(1);
    const [mail] = state.mails;
    expect(mail).toMatchObject({
      to: 'sales@vendor.example.in',
      replyTo: buyer.email,
      attachments: [
        {
          fileName: `Purchase order ${po.poNo.replaceAll('/', '-')}.pdf`,
          contentType: 'application/pdf',
        },
      ],
    });
    // The stored bytes are the ones mailed.
    expect(mail?.attachments?.[0]?.content).toEqual(PDF);
    expect(mail?.subject).toContain(po.poNo);
    // A repeat of the job mails nothing more.
    expect(PdfRenderResult.parse(await (await call(job)).json())).toMatchObject({
      outcome: 'duplicate',
    });
    expect(state.mails).toHaveLength(1);
  });

  it('by email, in the process that committed it when no queue is configured', async () => {
    const { po, event } = await sentVia('email');
    const result = await deliverEvent(event, { keyValue: memoryKeyValue(), requestId: newId() });
    expect(result).toEqual({ eventId: event.id, outcome: 'done' });
    expect(await fileRow(purchaseOrderPdfFileId(po.id, 1))).toMatchObject({ status: 'ready' });
    expect(state.mails.map((m) => m.to)).toEqual(['sales@vendor.example.in']);
  });

  it('by hand: prints the PDF as approved and mails nothing; a cancelled order is not mailed', async () => {
    const { po, event } = await sentVia('by_hand');
    expect(
      PdfRenderResult.parse(await (await call(purchaseOrderSentJobOf(event))).json()),
    ).toMatchObject({
      outcome: 'done',
      fileId: purchaseOrderPdfFileId(po.id, 1),
    });
    expect(state.mails).toEqual([]);

    const cancelled = await sentVia('email');
    await run(manager, cancelPurchaseOrder, {
      purchaseOrderId: cancelled.po.id,
      reason: 'Ordered twice',
    });
    const answer = await call(purchaseOrderSentJobOf(cancelled.event));
    expect(answer.status).toBe(200);
    expect(state.mails).toEqual([]);
  });
});
