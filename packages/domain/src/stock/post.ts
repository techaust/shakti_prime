import type { StockReason } from '@shakti/contracts';
import type { CommandContext } from '../command/context';
import { stockMovedPayload } from './events';
import { stockMove, type StockMoveLine } from './move';

/** What a command's audit row records of one movement: never a cost. */
export interface AuditedMove {
  stockReason: StockReason;
  quantity: string;
  serialNo: string | null;
}

/**
 * Posts a batch through `app.stock_move()` in the command's transaction, writes one audit row per
 * movement (its reason, quantity, serial and the person's note) and emits `inventory.stock.moved`
 * with the movements' ids, items, bins, quantities and reasons. Answers the movement ids.
 */
export async function postStockMoves(
  ctx: CommandContext,
  entityId: number,
  lines: readonly StockMoveLine[],
  audited: readonly AuditedMove[],
  note: string | null,
): Promise<{ movementIds: string[] }> {
  const movementIds = await stockMove(ctx.tx, lines);
  movementIds.forEach((id, i) => {
    const line = audited[i];
    ctx.audit({
      aggregateType: 'stock_movement',
      aggregateId: id,
      entityId,
      before: null,
      after: {
        stockReason: line?.stockReason,
        quantity: line === undefined ? undefined : Number(line.quantity),
        serialNo: line?.serialNo ?? null,
        adjustNote: note,
      },
    });
  });
  const first = movementIds[0];
  if (first !== undefined) {
    ctx.emit({
      type: 'inventory.stock.moved',
      entityId,
      aggregateType: 'stock_movement',
      aggregateId: first,
      payload: await stockMovedPayload(ctx.tx, movementIds),
    });
  }
  return { movementIds };
}
