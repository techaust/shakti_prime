import { OpeningStockImportRowInput } from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { eq, sql } from 'drizzle-orm';
import type { CommandContext } from '../command/context';
import { stockMovedPayload } from '../stock/events';
import { OPENING, REVERSAL, stockMove, type StockMoveLine } from '../stock/move';
import type { BatchRow } from './commit-leads';

/**
 * H1's opening stock import (docs/03-roadmap-appendix/phase3.md §6.2): a company's stock at
 * go-live, one row per hub, bin and item (one per serial for a tracked item) with its unit cost,
 * posted through `app.stock_move()` with reason `opening` under the import job's own reference.
 * The job's batches are one opening: a company with opening stock of another reference not
 * wholly reversed is refused, in the preview (`opening-stock-preview.ts`) and by the ledger.
 */

/**
 * Posts a batch of an opening stock job through `app.stock_move()` (reason `opening`, the job as
 * its reference) and emits `inventory.stock.moved`; answers each row's movement. The ledger
 * checks the grant (`inventory.stock.adjust`) and refuses opening stock of another reference.
 */
export async function commitOpeningStockBatch(
  ctx: CommandContext,
  tx: RequestTx,
  jobId: string,
  rows: readonly BatchRow[],
): Promise<{ rowNo: number; id: string }[]> {
  if (rows.length === 0) return [];
  const [job] = await tx
    .select({ entityId: schema.importJobs.entityId })
    .from(schema.importJobs)
    .where(eq(schema.importJobs.id, jobId));
  if (!job) throw new Error('an opening stock batch without its job');
  const lines: StockMoveLine[] = rows.map((row) => {
    const input = OpeningStockImportRowInput.parse(row.input);
    return {
      reason: OPENING,
      entityId: job.entityId,
      itemId: input.itemId,
      toBinId: input.binId,
      qty: input.qty,
      unitCost: input.unitCost,
      serialNo: input.serialNo,
      refType: 'import_job',
      refId: jobId,
    };
  });
  const ids = await stockMove(tx, lines);
  ctx.emit({
    type: 'inventory.stock.moved',
    entityId: job.entityId,
    aggregateType: 'stock_movement',
    aggregateId: ids[0] ?? jobId,
    payload: await stockMovedPayload(tx, ids),
  });
  return rows.map((row, index) => ({ rowNo: row.rowNo, id: ids[index] ?? '' }));
}

/**
 * Undoes the movements an opening stock job posted, by their reversals in one batch: those not
 * reversed yet (a line reversed by hand before reversing by hand was closed to openings stays as
 * it is), refused whole (`stock_insufficient`) when any of the stock has moved on since. Answers
 * how many it reversed.
 */
export async function reverseOpeningStock(
  tx: RequestTx,
  movementIds: readonly string[],
): Promise<number> {
  if (movementIds.length === 0) return 0;
  const open = (await tx.execute(sql`
    select m.id from stock_movements m
     where m.id = any(${`{${movementIds.join(',')}}`}::uuid[])
       and not exists (select 1 from stock_movements r where r.reverses_id = m.id)
     order by m.id`)) as unknown as { id: string }[];
  if (open.length === 0) return 0;
  const done = await stockMove(
    tx,
    open.map((o) => ({ reason: REVERSAL, reversesId: o.id })),
  );
  return done.length;
}
