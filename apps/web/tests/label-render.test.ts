import {
  newId,
  PdfRenderResult,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type DeliveredEvent,
  type LabelSheetDto,
  type LabelSize,
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
  principalFor,
} from '@shakti/db/testing';
import {
  databaseAuditSink,
  databaseOutboxSink,
  executeQuery,
  getFile,
  labelPayload,
  localDiskFileStore,
  memoryKeyValue,
  printLabels,
  runCommand,
  uploadKey,
  type FileStore,
} from '@shakti/domain';
import { createHash, createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrintRenderer } from '../src/print/renderer';

// Q1's sheets of QR labels through the render worker (docs/03-roadmap-appendix/phase3.md §7.4):
// the route, the loader, the commands and the database are real; Chromium is a stand-in that
// keeps the page and the stock size it was given (the security suite runs where no browser is
// installed; `e2e/labels.spec.ts` prints with the real one and times a sheet of 500).
interface RenderState {
  store: FileStore | undefined;
  sheets: { html: string; size: LabelSize }[];
}
const state = vi.hoisted((): RenderState => ({ store: undefined, sheets: [] }));

/** A PDF of two pages as Chromium writes its page objects. */
const PDF = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj << /Type /Pages /Count 2 >> endobj\n2 0 obj << /Type /Page >> endobj\n3 0 obj << /Type /Page >> endobj\n%%EOF\n',
);

vi.mock('../src/workers/pdf/deps', () => ({
  renderDeps: (principal: Principal, requestId: string) => {
    const renderer: PrintRenderer = {
      renderPdf: () => Promise.reject(new Error('no documents here')),
      renderLabel: (html, size) => {
        state.sheets.push({ html, size });
        return Promise.resolve(Buffer.from(PDF));
      },
      renderImage: () => Promise.reject(new Error('no images here')),
      connected: () => true,
      close: () => Promise.resolve(),
    };
    if (state.store === undefined) throw new Error('no store');
    return {
      principal,
      requestId,
      store: state.store,
      cipher: undefined,
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
const CURRENT_KEY = 'label-route-test-current-signing-key';
const APP = 'http://localhost:3000';
const ROUTE = `${APP}/api/v1/workers/pdf/render`;
const QSTASH_ENV = [
  'QSTASH_TOKEN',
  'QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY',
  'BETTER_AUTH_URL',
] as const;
const saved = new Map<string, string | undefined>();

/** The company whose labels are printed here; company 3 holds a serial it must never print. */
const ENTITY = 2;
const OTHER = 3;

let dir: string;
let worker: Principal;
let manager: Principal;
const tag = newId().slice(-8).toUpperCase();
const f = {
  hub: newId(),
  binA: newId(),
  binB: newId(),
  archived: newId(),
  item: newId(),
  serialA: newId(),
  serialB: newId(),
  serialOther: newId(),
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'shakti-labels-'));
  state.store = localDiskFileStore(dir, {
    signing: { secret: 'label suite signing phrase', url: (t) => `${APP}/files/${t}` },
  });
  worker = principalFor('system:workers', [ENTITY], { id: SYSTEM_WORKERS_PRINCIPAL_ID });
  manager = await createTestPrincipal('inventory_manager', [ENTITY]);
  const by = (await createTestPrincipal('executive')).id;
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
        values (${f.hub}, ${`L${tag}`}, ${`Label hub ${tag}`}, 'godown', '08', '302001', ${by})`;
      await tx`insert into bins (id, warehouse_id, code, kind, created_by) values
        (${f.binA}, ${f.hub}, 'R01-S01', 'storage', ${by}),
        (${f.binB}, ${f.hub}, 'R01-S02', 'storage', ${by}),
        (${f.archived}, ${f.hub}, 'R09-S09', 'storage', ${by})`;
      await tx`update bins set archived_at = now() where id = ${f.archived}`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked)
        values (${f.item}, ${`LP-${tag}`}, ${`Label pump ${tag}`}, 'pump', '8413', 'nos', true)`;
      await tx`insert into serials (id, entity_id, item_id, serial_no, state, bin_id, created_by, updated_by) values
        (${f.serialA}, ${ENTITY}, ${f.item}, ${`LS-${tag}-1`}, 'in_stock', ${f.binA}, ${by}, ${by}),
        (${f.serialB}, ${ENTITY}, ${f.item}, ${`LS-${tag}-2`}, 'in_stock', ${f.binA}, ${by}, ${by}),
        (${f.serialOther}, ${OTHER}, ${f.item}, ${`LS-${tag}-3`}, 'in_stock', ${f.binA}, ${by}, ${by})`;
    }),
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await closeOutboxDb();
  await closeDb();
});

beforeEach(() => {
  for (const name of QSTASH_ENV) saved.set(name, process.env[name]);
  process.env.QSTASH_TOKEN = 'label-route-test-token';
  process.env.QSTASH_CURRENT_SIGNING_KEY = CURRENT_KEY;
  process.env.QSTASH_NEXT_SIGNING_KEY = 'label-route-test-next-signing-key';
  process.env.BETTER_AUTH_URL = APP;
  state.sheets.length = 0;
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

function call(body: string): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  headers.set('upstash-signature', sign(body));
  return POST(new Request(ROUTE, { method: 'POST', headers, body }));
}

function sheetJob(labelKind: 'serial' | 'bin', ids: string[]): PdfRenderJob {
  return {
    eventId: newId(),
    entityId: ENTITY,
    target: { kind: 'labels', sheetId: newId(), labelKind, size: '50x25', ids },
  };
}

async function fileRow(id: string) {
  const [row] = await asMigrator(
    (m) => m<{ purpose: string; status: string; key: string; name: string }[]>`
      select purpose, status, key, name from files where id = ${id}`,
  );
  return row;
}

describe('a sheet of labels through the render route', () => {
  it('prints a hub’s bins at the stock size, stores the sheet under its id, once', async () => {
    const job = sheetJob('bin', [f.binB, f.binA]);
    if (job.target.kind !== 'labels') throw new Error('a sheet');
    const body = JSON.stringify(job);
    const response = await call(body);
    expect(response.status).toBe(200);
    expect(PdfRenderResult.parse(await response.json())).toEqual({
      eventId: job.eventId,
      outcome: 'done',
      fileId: job.target.sheetId,
      pages: 2,
      bytes: PDF.length,
    });
    expect(await fileRow(job.target.sheetId)).toEqual({
      purpose: 'label_sheet',
      status: 'ready',
      key: uploadKey(ENTITY, 'label_sheet', job.target.sheetId, 'application/pdf'),
      name: '2 labels.pdf',
    });
    expect(state.sheets).toHaveLength(1);
    const [sheet] = state.sheets;
    expect(sheet?.size).toBe('50x25');
    // In the order asked: bin B's label first.
    const html = sheet?.html ?? '';
    expect(html.indexOf('R01-S02')).toBeGreaterThan(-1);
    expect(html.indexOf('R01-S02')).toBeLessThan(html.indexOf('R01-S01'));
    expect(html).toContain(`Label hub ${tag}`);
    expect(html.match(/<svg/g)).toHaveLength(2);

    const again = await call(body);
    expect(PdfRenderResult.parse(await again.json())).toEqual({
      eventId: job.eventId,
      outcome: 'duplicate',
    });
    expect(state.sheets).toHaveLength(1);
  });

  it('prints only the company’s own serials, and leaves out an archived bin', async () => {
    const serials = sheetJob('serial', [f.serialA, f.serialOther, f.serialB]);
    await renderPdfJob(serials, renderDeps(worker, newId()));
    const html = state.sheets[0]?.html ?? '';
    expect(html).toContain(`LS-${tag}-1`);
    expect(html).toContain(`LS-${tag}-2`);
    expect(html).toContain(`LP-${tag}`);
    expect(html).not.toContain(`LS-${tag}-3`);
    expect(html.match(/<svg/g)).toHaveLength(2);

    await renderPdfJob(sheetJob('bin', [f.archived, f.binA]), renderDeps(worker, newId()));
    expect(state.sheets[1]?.html).not.toContain('R09-S09');
  });

  it('refuses, for good, a sheet with nothing the worker may print', async () => {
    const job = sheetJob('serial', [f.serialOther]);
    if (job.target.kind !== 'labels') throw new Error('a sheet');
    const response = await call(JSON.stringify(job));
    expect(response.status).toBe(404);
    expect(response.headers.get('upstash-nonretryable-error')).toBe('true');
    expect(state.sheets).toEqual([]);
    expect(await fileRow(job.target.sheetId)).toBeUndefined();
  });

  it('stores nothing for a principal without files.process, even the Executive', async () => {
    const executive = await createTestPrincipal('executive', [ENTITY]);
    const job = sheetJob('bin', [f.binA]);
    await expect(renderPdfJob(job, renderDeps(executive, newId()))).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(state.sheets).toEqual([]);
  });
});

describe('Print labels, from the command to the sheet a person opens', () => {
  it('prints in the process that committed it, and only a stock handler opens the sheet', async () => {
    const sheet = await asPrincipal<LabelSheetDto>(manager, (context) =>
      runCommand(
        printLabels,
        { context, audit: databaseAuditSink, outbox: databaseOutboxSink },
        { entityId: ENTITY, labelKind: 'serial', ids: [f.serialA] },
      ),
    );
    const [row] = await asOutboxPublisher(
      (m) => m<{ id: string; sequence: string; payload_json: Record<string, unknown> }[]>`
        select id, sequence::text, payload_json from outbox_events
         where aggregate_id = ${sheet.sheetId} and type = 'print.labels.requested'`,
    );
    if (row === undefined) throw new Error('no event');
    const event: DeliveredEvent = {
      id: row.id,
      sequence: row.sequence,
      type: 'print.labels.requested',
      entityId: ENTITY,
      aggregateType: 'label_sheet',
      aggregateId: sheet.sheetId,
      payload: { ...row.payload_json, v: 1 },
    };
    const result = await deliverEvent(event, { keyValue: memoryKeyValue(), requestId: newId() });
    expect(result).toEqual({ eventId: event.id, outcome: 'done' });
    expect(await fileRow(sheet.sheetId)).toMatchObject({ purpose: 'label_sheet', status: 'ready' });
    expect(state.sheets[0]?.html).toContain(`LS-${tag}-1`);
    // The code carries the serial's id alone.
    const { QUIET_ZONE, qrSvg } = await import('../src/print/qr');
    expect(state.sheets[0]?.html).toContain(
      await qrSvg(labelPayload('serial', f.serialA), QUIET_ZONE),
    );

    const read = (who: Principal) =>
      executeQuery(who, {}, (ctx) => getFile(ctx, sheet.sheetId), { name: 'labels.test' });
    expect(await read(manager)).toMatchObject({ id: sheet.sheetId, purpose: 'label_sheet' });
    for (const roleKey of ['store_manager', 'general_manager', 'tele_caller_cc'] as const) {
      expect(await read(await createTestPrincipal(roleKey, [ENTITY])), roleKey).toBeUndefined();
    }
    // The Inventory Manager of another company does not see it either.
    expect(await read(await createTestPrincipal('inventory_manager', [OTHER]))).toBeUndefined();
  });
});
