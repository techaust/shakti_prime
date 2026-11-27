import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type LabelSheetDto,
  type Principal,
} from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { executeQuery } from '../../src/command/execute';
import { runCommand } from '../../src/command/run-command';
import { printLabels, reprintLabels } from '../../src/commands/inventory/labels';
import { adjustStock } from '../../src/commands/inventory/stock';
import { labelPayload } from '../../src/labels/payload';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { loadLabelsForPrint, resolveScannedCode } from '../../src/queries/inventory/labels';
import { serialOf, stockFixture, type StockFixture } from '../stock/stock-fixture';

afterAll(closeDb);

/**
 * Q1's labels (docs/03-roadmap-appendix/phase3.md §7.4): printing and reprinting a sheet with
 * `inventory.stock.move` for the company, a reprint audited on each serial or bin with why; a
 * scanned code resolved under the caller's own row security; and the render worker's read of a
 * sheet, for `files.process` alone.
 */

let exec: Principal;
let manager: Principal;
let worker: Principal;
let f: StockFixture;
/** Two serials of company 1 and one of company 3, in the fixture's storage bin A. */
let serialA: string;
let serialB: string;
let serialOther: string;

function run<T = Record<string, unknown>>(
  principal: Principal,
  command: AnyCommand,
  input: unknown,
  requestId?: string,
): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(
      command,
      { context: requestId === undefined ? context : { ...context, requestId }, audit, outbox },
      input,
    ),
  ) as Promise<T>;
}

async function receiveSerial(entityId: number, serialNo: string): Promise<string> {
  await run({ ...exec, entityIds: [entityId] }, adjustStock, {
    entityId,
    itemId: f.pump,
    binId: f.binA,
    adjustment: 'gain',
    serialNos: [serialNo],
    note: 'Labels test stock',
  });
  const serial = await serialOf(f.pump, serialNo);
  if (serial === undefined) throw new Error('the serial was not made');
  return serial.id;
}

beforeAll(async () => {
  exec = await createTestPrincipal('executive');
  manager = await createTestPrincipal('inventory_manager', [1]);
  worker = principalFor('system:workers', [1], { id: SYSTEM_WORKERS_PRINCIPAL_ID });
  f = await stockFixture(exec.id);
  serialA = await receiveSerial(1, `LB-${f.tag}-1`);
  serialB = await receiveSerial(1, `LB-${f.tag}-2`);
  serialOther = await receiveSerial(3, `LB-${f.tag}-3`);
});

async function eventsOf(sheetId: string) {
  return asOutboxPublisher(
    (m) => m<{ type: string; entity_id: number; payload_json: Record<string, unknown> }[]>`
      select type, entity_id, payload_json from outbox_events where aggregate_id = ${sheetId}`,
  );
}

async function auditOf(requestId: string) {
  return asMigrator(
    (m) => m<
      {
        command: string;
        aggregate_type: string;
        aggregate_id: string;
        entity_id: number | null;
        after_json: Record<string, unknown>;
      }[]
    >`
      select command, aggregate_type, aggregate_id, entity_id, after_json from audit_logs
       where request_id = ${requestId} and outcome = 'ok'
       order by aggregate_id`,
  );
}

describe('inventory.label.print', () => {
  it('is refused without inventory.stock.move for the company, and to every agent', async () => {
    const input = { entityId: 1, labelKind: 'serial', ids: [serialA] };
    for (const roleKey of ['store_manager', 'general_manager', 'accounts'] as const) {
      await expect(
        run(await createTestPrincipal(roleKey, [1]), printLabels, input),
        roleKey,
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    // A field engineer moves stock for their own jobs only, never prints a company's labels.
    await expect(
      run(await createTestPrincipal('field_engineer', [1]), printLabels, input),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(run(principalFor('agent:chief', [1]), printLabels, input)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('is refused for a company outside the request, or a serial of another company', async () => {
    await expect(
      run(manager, printLabels, { entityId: 3, labelKind: 'serial', ids: [serialOther] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(manager, printLabels, { entityId: 1, labelKind: 'serial', ids: [serialA, serialOther] }),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'label_target_missing' } });
    // The Executive acting in company 1 cannot label company 3's serial under company 1 either.
    await expect(
      run({ ...exec, entityIds: [1] }, printLabels, {
        entityId: 1,
        labelKind: 'serial',
        ids: [serialOther],
      }),
    ).rejects.toMatchObject({ details: { reason: 'label_target_missing' } });
  });

  it('refuses an archived bin, an unknown id and the same id twice', async () => {
    await expect(
      run(manager, printLabels, { entityId: 1, labelKind: 'bin', ids: [f.binA, f.archivedBin] }),
    ).rejects.toMatchObject({ details: { reason: 'label_target_missing' } });
    await expect(
      run(manager, printLabels, { entityId: 1, labelKind: 'serial', ids: [newId()] }),
    ).rejects.toMatchObject({ details: { reason: 'label_target_missing' } });
    await expect(
      run(manager, printLabels, { entityId: 1, labelKind: 'bin', ids: [f.binA, f.binA] }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      run(manager, printLabels, { entityId: 1, labelKind: 'package', ids: [f.binA] }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('asks the render worker for a hub’s bin labels at the stock size, audited by count', async () => {
    const requestId = newId();
    const ids = [f.receiving, f.binA, f.binB, f.dispatch];
    const sheet = await run<LabelSheetDto>(
      manager,
      printLabels,
      { entityId: 1, labelKind: 'bin', ids },
      requestId,
    );
    expect(sheet).toMatchObject({ entityId: 1, labelKind: 'bin', size: '50x25', count: 4 });
    const events = await eventsOf(sheet.sheetId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'print.labels.requested',
      entity_id: 1,
      payload_json: { sheetId: sheet.sheetId, labelKind: 'bin', size: '50x25', ids },
    });
    expect(await auditOf(requestId)).toEqual([
      {
        command: 'inventory.label.print',
        aggregate_type: 'label_sheet',
        aggregate_id: sheet.sheetId,
        entity_id: 1,
        after_json: { labelKind: 'bin', labelCount: 4 },
      },
    ]);
  });

  it('prints the serials of the company, in the order given', async () => {
    const sheet = await run<LabelSheetDto>(manager, printLabels, {
      entityId: 1,
      labelKind: 'serial',
      ids: [serialB, serialA],
    });
    const [event] = await eventsOf(sheet.sheetId);
    expect(event?.payload_json).toMatchObject({ ids: [serialB, serialA], size: '50x25' });
  });
});

describe('inventory.label.reprint', () => {
  it('is refused without inventory.stock.move, to an agent, and in another company', async () => {
    const input = { entityId: 1, labelKind: 'serial', ids: [serialA], note: 'Label torn' };
    await expect(
      run(await createTestPrincipal('store_manager', [1]), reprintLabels, input),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(run(principalFor('agent:chief', [1]), reprintLabels, input)).rejects.toMatchObject(
      { code: 'forbidden' },
    );
    await expect(
      run(manager, reprintLabels, { ...input, entityId: 3, ids: [serialOther] }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(manager, reprintLabels, { ...input, ids: [serialOther] }),
    ).rejects.toMatchObject({ details: { reason: 'label_target_missing' } });
  });

  it('needs why: three characters at least', async () => {
    await expect(
      run(manager, reprintLabels, { entityId: 1, labelKind: 'serial', ids: [serialA], note: ' ' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('audits what was printed again, how many and why, on each serial and bin', async () => {
    const requestId = newId();
    const note = 'Label faded in the sun';
    const sheet = await run<LabelSheetDto>(
      manager,
      reprintLabels,
      { entityId: 1, labelKind: 'serial', ids: [serialA, serialB], note },
      requestId,
    );
    expect(sheet).toMatchObject({ labelKind: 'serial', count: 2, size: '50x25' });
    const rows = await auditOf(requestId);
    expect(rows.map((r) => r.aggregate_id).sort()).toEqual([serialA, serialB].sort());
    for (const row of rows) {
      expect(row).toMatchObject({
        command: 'inventory.label.reprint',
        aggregate_type: 'serial',
        entity_id: 1,
        after_json: { labelKind: 'serial', labelCount: 2, labelNote: note },
      });
    }
    const [event] = await eventsOf(sheet.sheetId);
    expect(event).toMatchObject({ type: 'print.labels.requested' });
    // The event carries ids, a kind and a size, never the note.
    expect(JSON.stringify(event?.payload_json)).not.toContain(note);

    // A bin is the group's: its row belongs to no one company.
    const binRequest = newId();
    await run(
      manager,
      reprintLabels,
      { entityId: 1, labelKind: 'bin', ids: [f.binA], note: 'Rack repainted' },
      binRequest,
    );
    expect(await auditOf(binRequest)).toEqual([
      expect.objectContaining({ aggregate_type: 'bin', aggregate_id: f.binA, entity_id: null }),
    ]);
  });
});

describe('resolveScannedCode', () => {
  const resolve = (principal: Principal, code: string) =>
    asPrincipal(principal, (ctx) => resolveScannedCode(ctx, { code }));

  it('opens a serial of the request’s companies and a live bin, under the caller’s policies', async () => {
    expect(await resolve(manager, labelPayload('serial', serialA))).toMatchObject({
      outcome: 'serial',
      serialId: serialA,
      entityId: 1,
      itemId: f.pump,
      sku: `SP-${f.tag}`,
      serialNo: `LB-${f.tag}-1`,
      state: 'in_stock',
      binId: f.binA,
    });
    // A handheld scanner's Enter after the code.
    expect(await resolve(manager, `${labelPayload('bin', f.binA)}\r\n`)).toEqual({
      outcome: 'bin',
      binId: f.binA,
      hubId: f.hub,
      binCode: 'A1',
      hubCode: `H${f.tag}`,
      kind: 'storage',
    });
    // The store manager reads stock and resolves labels too.
    expect(
      await resolve(
        await createTestPrincipal('store_manager', [1]),
        labelPayload('serial', serialA),
      ),
    ).toMatchObject({ outcome: 'serial', serialId: serialA });
  });

  it('says unknown for another company’s serial, an archived bin, a package or a bad label', async () => {
    for (const code of [
      labelPayload('serial', serialOther),
      labelPayload('serial', newId()),
      labelPayload('bin', f.archivedBin),
      labelPayload('package', newId()),
      `SP1:S:${f.tag}`,
      `SP9:S:${serialA}`,
    ]) {
      expect(await resolve(manager, code), code).toEqual({ outcome: 'unknown' });
    }
    // The Executive acting in company 1 alone does not see company 3's serial either.
    expect(await resolve({ ...exec, entityIds: [1] }, labelPayload('serial', serialOther))).toEqual(
      { outcome: 'unknown' },
    );
    expect(await resolve({ ...exec, entityIds: [3] }, labelPayload('serial', serialOther))).toEqual(
      expect.objectContaining({ outcome: 'serial', entityId: 3 }),
    );
  });

  it('says not ours for a supplier’s barcode or a web address', async () => {
    for (const code of ['8901234567890', 'https://shaktiprime.com/s/ASH26C000001', `SP-${f.tag}`]) {
      expect(await resolve(manager, code), code).toEqual({ outcome: 'not_ours' });
    }
  });

  it('is refused to a caller who does not read stock', async () => {
    await expect(
      resolve(principalFor('tele_caller_cc', [1]), labelPayload('serial', serialA)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('loadLabelsForPrint (app.labels_for_print)', () => {
  it('reads a sheet for the render worker alone, in the order asked', async () => {
    const serials = await executeQuery(
      worker,
      { entityIds: [1] },
      (ctx) => loadLabelsForPrint(ctx, 'serial', [serialB, serialOther, serialA]),
      { name: 'labels.test' },
    );
    // Company 3's serial is left out of company 1's sheet.
    expect(serials).toEqual({
      labelKind: 'serial',
      labels: [
        expect.objectContaining({ id: serialB, serialNo: `LB-${f.tag}-2`, sku: `SP-${f.tag}` }),
        expect.objectContaining({ id: serialA, serialNo: `LB-${f.tag}-1` }),
      ],
    });
    expect(serials.labels[0]).toMatchObject({ itemName: `Stock pump ${f.tag}` });
    expect(typeof (serials.labels[0] as { companyName?: unknown }).companyName).toBe('string');

    const bins = await executeQuery(
      worker,
      { entityIds: [1] },
      (ctx) => loadLabelsForPrint(ctx, 'bin', [f.binB, f.archivedBin, f.binA, f.binB]),
      { name: 'labels.test' },
    );
    expect(bins).toEqual({
      labelKind: 'bin',
      labels: [
        { id: f.binB, binCode: 'B1', hubCode: `H${f.tag}`, hubName: `Hub ${f.tag}` },
        { id: f.binA, binCode: 'A1', hubCode: `H${f.tag}`, hubName: `Hub ${f.tag}` },
      ],
    });
  });

  it('is refused to a person, the Executive included, and waits for dispatch for packages', async () => {
    for (const who of [manager, exec]) {
      await expect(
        executeQuery(who, { entityIds: [1] }, (ctx) => loadLabelsForPrint(ctx, 'bin', [f.binA]), {
          name: 'labels.test',
        }),
      ).rejects.toMatchObject({ cause: { code: '42501', message: 'files.process is required' } });
    }
    await expect(
      executeQuery(
        worker,
        { entityIds: [1] },
        (ctx) => loadLabelsForPrint(ctx, 'package', [newId()]),
        { name: 'labels.test' },
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
