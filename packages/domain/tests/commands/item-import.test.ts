import { newId, type ImportJobDto, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createReadyImportFile,
  createTestPrincipal,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { Command } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { createItem } from '../../src/commands/catalogue/items';
import { createKit } from '../../src/commands/catalogue/kits';
import { commitImportBatch, commitImportJob } from '../../src/commands/imports/commit-job';
import { createImportJob } from '../../src/commands/imports/create-job';
import { mapImportJob } from '../../src/commands/imports/map-job';
import { previewImportJob } from '../../src/commands/imports/preview-job';
import { rollbackImportJob } from '../../src/commands/imports/rollback-job';
import { parseImportFile } from '../../src/imports/parse';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { listImportRows } from '../../src/queries/imports/import-queries';

// The items import kind (phase3 §6.1, C5) on real Postgres: who may import, each refusal with its
// reason, a known code changing its item through `catalogue.item.update`, a new one made through
// `catalogue.item.create`, a row the catalogue no longer takes at commit set aside whole, and the
// rollback. Items are shared and never cleaned, so every code carries the run's tag.

afterAll(closeDb);
vi.setConfig({ testTimeout: 60_000 });

const tag = newId().slice(-8).toUpperCase();
let seq = 0;
const code = (kind: string) => `T-${tag}-IMP-${kind}-${String((seq += 1))}`;

function run<I extends z.ZodType, O extends z.ZodType>(
  principal: Principal,
  command: Command<I, O>,
  input: unknown,
): Promise<z.output<O>> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

async function startedJob(principal: Principal, csv: string, entityId = 1): Promise<ImportJobDto> {
  const parsed = await parseImportFile(new TextEncoder().encode(csv));
  const fileId = await createReadyImportFile(entityId, principal.id, { name: 'items.csv' });
  return run(principal, createImportJob, {
    entityId,
    kind: 'items',
    fileId,
    format: parsed.format,
    columns: parsed.columns,
    rows: parsed.rows,
  });
}

async function rowsOf(principal: Principal, jobId: string) {
  const page = await asPrincipal(principal, (ctx) =>
    listImportRows(ctx, { entityId: 1, jobId, limit: 200 }),
  );
  return page.rows;
}

async function committed(principal: Principal, job: ImportJobDto): Promise<ImportJobDto> {
  let current = await run(principal, commitImportJob, { entityId: job.entityId, jobId: job.id });
  while (current.state === 'committing') {
    current = await run(principal, commitImportBatch, { entityId: job.entityId, jobId: job.id });
  }
  return current;
}

const HEADER =
  'Item code,Item name,Category,HSN,Unit,Purchase unit,Factor,Serial,Warranty,Supplier warranty,Barcode,Serial pattern';
const MAPPING = {
  columns: {
    sku: 'Item code',
    itemName: 'Item name',
    category: 'Category',
    hsn: 'HSN',
    unit: 'Unit',
    purchaseUnit: 'Purchase unit',
    purchaseUnitFactor: 'Factor',
    isSerialTracked: 'Serial',
    warrantyMonths: 'Warranty',
    supplierWarrantyMonths: 'Supplier warranty',
    barcode: 'Barcode',
    serialPattern: 'Serial pattern',
  },
};

async function itemBySku(sku: string) {
  const [row] = await asMigrator(
    (m) => m<
      {
        id: string;
        name: string;
        hsn: string;
        unit: string;
        purchase_unit: string | null;
        purchase_unit_factor: string | null;
        warranty_months: number | null;
        barcode: string | null;
        archived: boolean;
      }[]
    >`select id, name, hsn, unit, purchase_unit, purchase_unit_factor, warranty_months, barcode,
             archived_at is not null as archived
        from items where sku = ${sku}`,
  );
  return row;
}

let gm: Principal;

beforeAll(async () => {
  // A General Manager holds imports.write and catalogue.write, and works in every company.
  gm = await createTestPrincipal('general_manager');
});

describe('items imports: who may import', () => {
  it('refuses a GM acting for one company, and a role without catalogue.write', async () => {
    const csv = `${HEADER}\n${code('ONE')},Cable one,Cable,8544,Metre,,,,,,,\n`;
    const one = await createTestPrincipal('general_manager', [1]);
    await expect(startedJob(one, csv)).rejects.toMatchObject({
      code: 'forbidden',
      details: { reason: 'catalogue_needs_all_companies' },
    });
    // An Inventory Manager holds catalogue.write but not imports.write.
    const inventory = await createTestPrincipal('inventory_manager');
    await expect(startedJob(inventory, csv)).rejects.toMatchObject({ code: 'forbidden' });
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    await expect(startedJob(caller, csv)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses the later steps to a GM who now acts for one company', async () => {
    const job = await startedJob(
      gm,
      `${HEADER}\n${code('TWO')},Cable two,Cable,8544,Metre,,,,,,,\n`,
    );
    const one = { ...gm, entityIds: [1] };
    await expect(
      run(one, mapImportJob, { entityId: 1, jobId: job.id, mapping: MAPPING }),
    ).rejects.toMatchObject({ details: { reason: 'catalogue_needs_all_companies' } });
    await run(gm, mapImportJob, { entityId: 1, jobId: job.id, mapping: MAPPING });
    await expect(run(one, previewImportJob, { entityId: 1, jobId: job.id })).rejects.toMatchObject({
      details: { reason: 'catalogue_needs_all_companies' },
    });
    const previewed = await run(gm, previewImportJob, { entityId: 1, jobId: job.id });
    await expect(
      run(one, commitImportJob, { entityId: 1, jobId: previewed.id }),
    ).rejects.toMatchObject({ details: { reason: 'catalogue_needs_all_companies' } });
  });

  it('refuses a mapping without the item code column', async () => {
    const job = await startedJob(gm, `${HEADER}\n${code('MAP')},Cable,Cable,8544,Metre,,,,,,,\n`);
    await expect(
      run(gm, mapImportJob, {
        entityId: 1,
        jobId: job.id,
        mapping: { columns: { itemName: 'Item name' } },
      }),
    ).rejects.toMatchObject({ details: { reason: 'import_mapping_incomplete' } });
  });
});

describe('items imports: rows checked, added and changed', () => {
  it('refuses each bad row with its reason, adds new codes and changes known ones', async () => {
    const known = await run(gm, createItem, {
      sku: code('KNOWN'),
      name: 'Known cable',
      category: 'cable',
      hsn: '8544',
      unit: 'metre',
      specs: { cores: 2 },
      warrantyMonths: 6,
    });
    const otherBarcode = `BC${tag}${String((seq += 1))}`;
    await run(gm, createItem, {
      sku: code('HOLDER'),
      name: 'Barcode holder',
      category: 'cable',
      hsn: '8544',
      unit: 'metre',
      specs: {},
      barcode: otherBarcode,
    });
    const fresh = code('NEW');
    const freshBarcode = `BC${tag}${String((seq += 1))}`;
    const lines = [
      HEADER,
      // 1: a new cable bought in coils of 100 metres.
      `${fresh},Cable 4 core,Cable,8544 11 00,Mtr,Pcs,100,No,12,18,${freshBarcode},`,
      // 2: the known item, its warranty and HSN changed; a blank name keeps its own.
      `${known.sku},,,85444999,,,,,24,,,`,
      // 3: the same code again: skipped.
      `${fresh},Cable 4 core again,Cable,8544,Metre,,,,,,,`,
      // 4 to 11: one refusal each.
      `${code('CAT')},Thing,Gadget,8544,Metre,,,,,,,`,
      `${code('HSN')},Thing,Cable,85441,Metre,,,,,,,`,
      `${code('UNIT')},Thing,Cable,8544,Furlong,,,,,,,`,
      `${code('PAT')},Pump thing,Other,8413,Nos,,,Yes,,,,SP[0-9`,
      `${code('BAR')},Thing,Cable,8544,Metre,,,,,,${otherBarcode},`,
      `${code('BAR2')},Thing,Cable,8544,Metre,,,,,,${freshBarcode},`,
      `${code('PUMP')},A new pump,Pump,8413,Nos,,,,,,,`,
      `${code('MISS')},,Cable,8544,Metre,,,,,,,`,
      // 12: a factor missing for a purchase unit other than the stock unit.
      `${code('FAC')},Thing,Cable,8544,Metre,Nos,,,,,,`,
    ];
    const job = await startedJob(gm, lines.join('\n') + '\n');
    await run(gm, mapImportJob, { entityId: 1, jobId: job.id, mapping: MAPPING });
    const previewed = await run(gm, previewImportJob, { entityId: 1, jobId: job.id });
    expect(previewed).toMatchObject({ validRows: 2, skippedRows: 1, invalidRows: 9 });
    const rows = await rowsOf(gm, job.id);
    expect(rows.map((r) => [r.rowNo, r.state, r.errors])).toEqual([
      [1, 'valid', []],
      [2, 'valid', []],
      [3, 'skipped', []],
      [4, 'invalid', [{ field: 'category', code: 'category_unknown' }]],
      [5, 'invalid', [{ field: 'hsn', code: 'hsn_invalid' }]],
      [6, 'invalid', [{ field: 'unit', code: 'unit_unknown' }]],
      [7, 'invalid', [{ field: 'serialPattern', code: 'serial_pattern_invalid' }]],
      [8, 'invalid', [{ field: 'barcode', code: 'barcode_taken' }]],
      [9, 'invalid', [{ field: 'barcode', code: 'barcode_taken' }]],
      [10, 'invalid', [{ field: 'category', code: 'item_details_needed' }]],
      [11, 'invalid', [{ field: 'itemName', code: 'required' }]],
      [12, 'invalid', [{ field: 'purchaseUnitFactor', code: 'invalid' }]],
    ]);

    const done = await committed(gm, previewed);
    expect(done).toMatchObject({ state: 'committed', committedRows: 2 });
    expect(await itemBySku(fresh)).toMatchObject({
      name: 'Cable 4 core',
      hsn: '85441100',
      unit: 'metre',
      purchase_unit: 'nos',
      purchase_unit_factor: '100.000',
      warranty_months: 12,
      barcode: freshBarcode,
    });
    expect(await itemBySku(known.sku)).toMatchObject({
      name: 'Known cable',
      hsn: '85444999',
      warranty_months: 24,
    });
    const after = await rowsOf(gm, job.id);
    expect(after.slice(0, 2).map((r) => r.createdType)).toEqual(['item', null]);

    // Each item went through its own command: audited as the importer, for no one company.
    const audits = await asMigrator(
      (m) => m<{ command: string; aggregate_id: string }[]>`
        select command, aggregate_id from audit_logs
         where actor_principal_id = ${gm.id} and aggregate_type = 'item' and outcome = 'ok'
           and aggregate_id = any(${[known.id, after[0]?.createdId ?? known.id]})
         order by created_at`,
    );
    expect(audits.map((a) => a.command)).toEqual([
      'catalogue.item.create',
      'catalogue.item.create',
      'catalogue.item.update',
    ]);

    // The rollback takes the new item out of sale; the change to the known item stays.
    const back = await run(gm, rollbackImportJob, { entityId: 1, jobId: job.id });
    expect(back.state).toBe('rolled_back');
    expect(await itemBySku(fresh)).toMatchObject({ archived: true });
    expect(await itemBySku(known.sku)).toMatchObject({ archived: false, warranty_months: 24 });
  });

  it('sets aside a row the catalogue no longer takes at commit, and never half-writes its item', async () => {
    const late = code('LATE');
    const sharedBarcode = `BC${tag}${String((seq += 1))}`;
    const kept = code('KEPT');
    const job = await startedJob(
      gm,
      [
        HEADER,
        `${late},Late cable,Cable,8544,Metre,,,,12,,${sharedBarcode},`,
        `${kept},Kept cable,Cable,8544,Metre,,,,6,,,`,
      ].join('\n') + '\n',
    );
    await run(gm, mapImportJob, { entityId: 1, jobId: job.id, mapping: MAPPING });
    const previewed = await run(gm, previewImportJob, { entityId: 1, jobId: job.id });
    expect(previewed.validRows).toBe(2);
    // Someone gives the barcode to another item between the check and the commit.
    await run(gm, createItem, {
      sku: code('THIEF'),
      name: 'Barcode taken since',
      category: 'cable',
      hsn: '8544',
      unit: 'metre',
      specs: {},
      barcode: sharedBarcode,
    });
    const done = await committed(gm, previewed);
    expect(done).toMatchObject({ state: 'committed', committedRows: 1, invalidRows: 1 });
    const rows = await rowsOf(gm, job.id);
    expect(rows.map((r) => [r.state, r.errors])).toEqual([
      ['invalid', [{ field: 'barcode', code: 'barcode_taken' }]],
      ['committed', []],
    ]);
    // Nothing of the refused row reached the catalogue.
    expect(await itemBySku(late)).toBeUndefined();
    expect(await itemBySku(kept)).toMatchObject({ warranty_months: 6 });
  });

  it('keeps on rollback an item a kit still sold holds', async () => {
    const inKit = code('KIT');
    const job = await startedJob(gm, `${HEADER}\n${inKit},Kit cable,Cable,8544,Metre,,,,,,,\n`);
    await run(gm, mapImportJob, { entityId: 1, jobId: job.id, mapping: MAPPING });
    await committed(gm, await run(gm, previewImportJob, { entityId: 1, jobId: job.id }));
    const item = await itemBySku(inKit);
    if (item === undefined) throw new Error('the item was not added');
    await run(gm, createKit, {
      sku: code('K'),
      name: 'Kit holding it',
      components: [{ itemId: item.id, qty: '10' }],
    });
    const back = await run(gm, rollbackImportJob, { entityId: 1, jobId: job.id });
    expect(back.state).toBe('rolled_back');
    expect(await itemBySku(inKit)).toMatchObject({ archived: false });
  });
});
