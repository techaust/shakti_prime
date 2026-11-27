import type { StockReason } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../command/context';
import { stockMovedPayload } from '../stock/events';

/**
 * The audit rows of a goods receipt's movements, one per movement as the stock commands write
 * them (its reason, quantity and serial), never a cost: for `procurement.grn.post` and `.reverse`.
 */
export async function auditReceiptMovements(
  ctx: CommandContext,
  entityId: number,
  movementIds: readonly string[],
): Promise<void> {
  if (movementIds.length === 0) return;
  const rows = (await ctx.tx.execute(sql`
    select m.id, m.reason, m.qty::text as qty, s.serial_no as "serialNo"
      from stock_movements m
      left join serials s on s.id = m.serial_id
     where m.id = any (${`{${movementIds.join(',')}}`}::uuid[])
     order by m.id`)) as unknown as {
    id: string;
    reason: StockReason;
    qty: string;
    serialNo: string | null;
  }[];
  for (const row of rows) {
    ctx.audit({
      aggregateType: 'stock_movement',
      aggregateId: row.id,
      entityId,
      before: null,
      after: { stockReason: row.reason, quantity: Number(row.qty), serialNo: row.serialNo },
    });
  }
}

/** `inventory.stock.moved` for a goods receipt's movements: ids, items, bins and quantities. */
export async function emitReceiptMoved(
  ctx: CommandContext,
  entityId: number,
  movementIds: string[],
): Promise<void> {
  const first = movementIds[0];
  if (first === undefined) return;
  ctx.emit({
    type: 'inventory.stock.moved',
    entityId,
    aggregateType: 'stock_movement',
    aggregateId: first,
    payload: await stockMovedPayload(ctx.tx, movementIds),
  });
}
