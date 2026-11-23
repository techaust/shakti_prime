import {
  OpeningStockImportRowInput,
  type ImportRowErrorDto,
  type OpeningStockImportField,
  type OpeningStockImportMapping,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

/**
 * The preview of H1's opening stock import (docs/03-roadmap-appendix/phase3.md §6.2): each row
 * found by hub, bin and stock code for the job's company, before anything is posted. Kept apart
 * from the commit, which emits the stock event (event-emitters.test.ts reads each module).
 */

/** What the preview found for one row. */
export type OpeningRowFinding =
  | { state: 'valid'; input: OpeningStockImportRowInput }
  | { state: 'invalid'; errors: ImportRowErrorDto[] };

interface FileRow {
  rowNo: number;
  raw: Readonly<Record<string, string>>;
}

const QTY = /^\d{1,9}(\.\d{1,3})?$/;
const COST = /^\d{1,10}(\.\d{1,4})?$/;

/** Whether the company holds opening stock, of any reference, not wholly reversed. */
async function openingPosted(tx: RequestTx, entityId: number): Promise<boolean> {
  const rows = (await tx.execute(sql`
    select exists (select 1 from stock_movements m
                    where m.entity_id = ${entityId} and m.reason = 'opening'
                      and not exists (select 1 from stock_movements r where r.reverses_id = m.id)) as posted`)) as unknown as {
    posted: boolean;
  }[];
  return rows[0]?.posted === true;
}

/**
 * Checks every row of an opening stock file for the job's company: the hub, bin and item by
 * code, the quantity and unit cost, and the serial a tracked item needs (each once, in any case,
 * and not one the company already holds). Opening stock already entered refuses every row.
 */
export async function previewOpeningStock(
  tx: RequestTx,
  rows: readonly FileRow[],
  mapping: OpeningStockImportMapping,
  entityId: number,
): Promise<OpeningRowFinding[]> {
  const cellOf =
    (raw: Readonly<Record<string, string>>) =>
    (field: OpeningStockImportField): string => {
      const column = mapping.columns[field];
      return column === undefined ? '' : (raw[column] ?? '').trim();
    };
  const [company] = await tx
    .select({
      code: schema.entities.code,
      brand: schema.entities.brandName,
      legal: schema.entities.legalName,
    })
    .from(schema.entities)
    .where(eq(schema.entities.id, entityId));
  const companyNames = new Set(
    [company?.code, company?.brand, company?.legal].flatMap((n) => (n ? [n.toLowerCase()] : [])),
  );
  if (await openingPosted(tx, entityId)) {
    return rows.map(() => ({
      state: 'invalid',
      errors: [{ field: 'row', code: 'opening_stock_posted' }],
    }));
  }

  const w = schema.warehouses;
  const hubs = await tx.select({ id: w.id, code: w.code }).from(w).where(isNull(w.archivedAt));
  const hubOf = new Map(hubs.map((h) => [h.code.toLowerCase(), h.id]));
  const b = schema.bins;
  const bins = await tx
    .select({ id: b.id, hubId: b.warehouseId, code: b.code })
    .from(b)
    .where(isNull(b.archivedAt));
  const binOf = new Map(bins.map((x) => [`${x.hubId}/${x.code.toLowerCase()}`, x.id]));
  const skus = [...new Set(rows.map((r) => cellOf(r.raw)('sku').toUpperCase()).filter(Boolean))];
  const i = schema.items;
  const items =
    skus.length === 0
      ? []
      : await tx
          .select({
            id: i.id,
            sku: i.sku,
            tracked: i.isSerialTracked,
            active: sql<boolean>`(${i.isActive} and ${i.archivedAt} is null)`,
          })
          .from(i)
          .where(inArray(i.sku, skus));
  const itemOf = new Map(items.map((x) => [x.sku, x]));
  const held = new Set<string>();
  const tracked = items.filter((x) => x.tracked).map((x) => x.id);
  if (tracked.length > 0) {
    const s = schema.serials;
    const existing = await tx
      .select({ itemId: s.itemId, serialNo: s.serialNo })
      .from(s)
      .where(and(eq(s.entityId, entityId), inArray(s.itemId, tracked)));
    for (const e of existing) held.add(`${e.itemId}/${e.serialNo.toLowerCase()}`);
  }

  const seen = new Set<string>();
  return rows.map((row): OpeningRowFinding => {
    const cell = cellOf(row.raw);
    const errors = new Map<string, ImportRowErrorDto>();
    const add = (error: ImportRowErrorDto) => {
      if (!errors.has(error.field)) errors.set(error.field, error);
    };
    const companyCell = cell('company');
    if (companyCell !== '' && !companyNames.has(companyCell.toLowerCase())) {
      add({ field: 'company', code: 'company_mismatch' });
    }
    const hubCell = cell('hub');
    const hubId = hubOf.get(hubCell.toLowerCase());
    if (hubCell === '') add({ field: 'hub', code: 'required' });
    else if (hubId === undefined) add({ field: 'hub', code: 'hub_unknown' });
    const binCell = cell('bin');
    const binId = hubId === undefined ? undefined : binOf.get(`${hubId}/${binCell.toLowerCase()}`);
    if (binCell === '') add({ field: 'bin', code: 'required' });
    else if (hubId !== undefined && binId === undefined) add({ field: 'bin', code: 'bin_unknown' });
    const skuCell = cell('sku').toUpperCase();
    const item = itemOf.get(skuCell);
    if (skuCell === '') add({ field: 'sku', code: 'required' });
    else if (item === undefined) add({ field: 'sku', code: 'sku_unknown' });
    else if (!item.active) add({ field: 'sku', code: 'item_not_stockable' });
    const serialCell = cell('serialNo');
    const qtyCell = cell('qty') === '' && serialCell !== '' ? '1' : cell('qty').replaceAll(',', '');
    if (qtyCell === '') add({ field: 'qty', code: 'required' });
    else if (!QTY.test(qtyCell) || Number(qtyCell) <= 0) add({ field: 'qty', code: 'invalid' });
    const costCell = cell('unitCost').replaceAll(',', '');
    if (costCell === '') add({ field: 'unitCost', code: 'required' });
    else if (!COST.test(costCell)) add({ field: 'unitCost', code: 'invalid' });
    if (item !== undefined) {
      if (item.tracked && serialCell === '') add({ field: 'serialNo', code: 'serial_required' });
      else if (!item.tracked && serialCell !== '') {
        add({ field: 'serialNo', code: 'serial_not_tracked' });
      } else if (item.tracked && serialCell.length > 100) {
        add({ field: 'serialNo', code: 'too_long' });
      } else if (item.tracked) {
        const key = `${item.id}/${serialCell.toLowerCase()}`;
        if (held.has(key) || seen.has(key)) add({ field: 'serialNo', code: 'serial_taken' });
        seen.add(key);
        if (QTY.test(qtyCell) && Number(qtyCell) !== 1) add({ field: 'qty', code: 'serial_qty' });
      }
    }
    if (errors.size > 0 || item === undefined || binId === undefined) {
      return { state: 'invalid', errors: [...errors.values()] };
    }
    return {
      state: 'valid',
      input: OpeningStockImportRowInput.parse({
        binId,
        itemId: item.id,
        qty: qtyCell,
        unitCost: costCell,
        serialNo: item.tracked ? serialCell : null,
      }),
    };
  });
}
