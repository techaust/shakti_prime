import {
  DomainError,
  ItemImportRowInput,
  type ImportRowErrorDto,
  type ItemImportRowInput as ItemImportRow,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { eq, inArray } from 'drizzle-orm';
import type { CommandContext } from '../command/context';
import { createItem, updateItem } from '../commands/catalogue/items';
import type { BatchRow } from './commit-leads';
import { planItemRow, type ExistingItem } from './items';
import { importRowKey } from './row-key';

/** Codes and barcodes looked up per statement. */
const CHUNK = 1000;

/**
 * A row of an items file the commit sets aside with its finding, the rest of the batch going on:
 * the catalogue changed since the preview (the item was taken out of sale, its barcode taken by
 * another item, or a change made its row no longer fit).
 */
export class ItemRowRefused extends Error {
  readonly finding: ImportRowErrorDto;

  constructor(finding: ImportRowErrorDto) {
    super('an items row was refused at commit');
    this.name = 'ItemRowRefused';
    this.finding = finding;
  }
}

/** The finding of an item command's refusal of a row, or undefined for a fault of the job. */
function refusalOf(error: unknown): ImportRowErrorDto | undefined {
  if (!(error instanceof DomainError)) return undefined;
  switch (error.details?.reason) {
    case 'item_barcode_taken':
      return { field: 'barcode', code: 'barcode_taken' };
    case 'catalogue_item_missing':
      return { field: 'sku', code: 'item_archived' };
    case 'item_sku_taken':
      return { field: 'sku', code: 'invalid' };
    default:
      return error.code === 'validation_failed' ? { field: 'row', code: 'invalid' } : undefined;
  }
}

/** The items of the catalogue with these codes, archived ones included, by code. */
export async function itemsBySku(
  tx: RequestTx,
  skus: readonly string[],
): Promise<Map<string, ExistingItem>> {
  const found = new Map<string, ExistingItem>();
  const unique = [...new Set(skus)];
  for (let start = 0; start < unique.length; start += CHUNK) {
    const rows = await tx
      .select()
      .from(schema.items)
      .where(inArray(schema.items.sku, unique.slice(start, start + CHUNK)));
    for (const row of rows) found.set(row.sku, row);
  }
  return found;
}

/** The code of the item holding each of these barcodes. */
export async function skusByBarcode(
  tx: RequestTx,
  barcodes: readonly string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const unique = [...new Set(barcodes)];
  for (let start = 0; start < unique.length; start += CHUNK) {
    const rows = await tx
      .select({ sku: schema.items.sku, barcode: schema.items.barcode })
      .from(schema.items)
      .where(inArray(schema.items.barcode, unique.slice(start, start + CHUNK)));
    for (const row of rows) if (row.barcode !== null) found.set(row.barcode, row.sku);
  }
  return found;
}

/**
 * Commits one row of an items file in the row's own savepoint (phase3 §6.1): the item with the
 * row's code is found again and locked, and the row runs `catalogue.item.update` over it, or
 * `catalogue.item.create` for a new code, as the caller, each with its own guard, audit row and
 * event, and the idempotency key `import:{job}:{row}`. Answers the item a new code made, or none
 * for an item changed. A row the catalogue no longer takes throws `ItemRowRefused` with its
 * finding, so the savepoint takes back anything it did.
 */
export async function commitItemRow(
  ctx: CommandContext,
  tx: RequestTx,
  jobId: string,
  row: BatchRow,
): Promise<{ id: string | null }> {
  const input: ItemImportRow = ItemImportRowInput.parse(row.input);
  const [existing] = await tx
    .select()
    .from(schema.items)
    .where(eq(schema.items.sku, input.sku))
    .limit(1)
    .for('update');
  const plan = planItemRow(input, existing);
  if (plan.kind === 'refused') {
    throw new ItemRowRefused(plan.errors[0] ?? { field: 'row', code: 'invalid' });
  }
  const options = { tx, idempotencyKey: importRowKey(jobId, row.rowNo), inImportBatch: true };
  try {
    if (plan.kind === 'create') {
      const made = await ctx.run(createItem, plan.input, options);
      return { id: made.id };
    }
    await ctx.run(updateItem, plan.input, options);
    return { id: null };
  } catch (error) {
    const finding = refusalOf(error);
    if (finding === undefined) throw error;
    throw new ItemRowRefused(finding);
  }
}
