import { PostStockCountInput, StockCountPostedDto } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';
import { readReviewLines } from '../../queries/inventory/counts';
import { transition } from '../../state-machines/define-machine';
import { serialMachine } from '../../state-machines/machines/serial';
import { postStockMoves } from '../../stock/post';
import { planCountMoves } from './counts-plan';
import {
  COUNT_AUDIT_FIELDS,
  COUNT_CONSTRAINTS,
  countRecord,
  fireCount,
  lockCount,
  setCountState,
  toCountDto,
  viaDefiner,
} from './counts-shared';

/**
 * `inventory.count.post` (`inventory.stock.adjust`): a reviewed count, every item in every bin
 * counted and no recount open, posts each variance as a `count` movement through
 * `app.stock_move()` in one batch, so the ledger then equals what was counted plus what moved
 * after each count. The variances are read in one statement of `app.stock_count_review()`: a
 * movement committing meanwhile changes the balance and the movements since by the same amount, so
 * what posts does not change. Each movement's audit row carries its quantity, never a cost.
 */
export const postStockCount = defineCommand({
  name: 'inventory.count.post',
  permission: 'inventory.stock.adjust',
  minScope: 'entity',
  peopleOnly: true,
  input: PostStockCountInput,
  output: StockCountPostedDto,
  auditFields: [...COUNT_AUDIT_FIELDS, 'stockReason', 'serialNo', 'adjustNote'],
  constraintReasons: {
    ...COUNT_CONSTRAINTS,
    serials_item_serial_no_unique: 'stock_serial_exists',
    stock_movements_reverses_unique: 'stock_already_reversed',
  },
  async handler(ctx, input) {
    const row = await lockCount(ctx, input.countId);
    const record = await countRecord(ctx, row);
    const to = fireCount(ctx, record, 'post');
    const lines = await viaDefiner(() => readReviewLines(ctx.tx, row.id));
    const notes = new Map(input.serialNotes.map((n) => [n.lineId, n.note]));
    const plan = planCountMoves(
      row.entityId,
      row.id,
      lines,
      (lineId) => notes.get(lineId) ?? input.note,
    );
    for (const move of plan) {
      if (move.serial === null) continue;
      transition(serialMachine, move.serial.record, move.serial.event, {
        actor: { kind: 'principal', principal: ctx.principal },
        now: ctx.now,
        params: { fromBinId: move.serial.fromBinId },
      });
    }
    const { movementIds } =
      plan.length === 0
        ? { movementIds: [] as string[] }
        : await viaDefiner(() =>
            postStockMoves(
              ctx,
              row.entityId,
              plan.map((m) => m.line),
              plan.map((m) => ({
                stockReason: m.line.reason,
                quantity: m.line.qty,
                serialNo: m.serialNo,
              })),
              input.note,
            ),
          );
    const updated = await setCountState(ctx, row, to, {
      postedAt: ctx.now,
      postedBy: ctx.principal.id,
      postNote: input.note,
    });
    ctx.audit({
      aggregateType: 'stock_count',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { state: row.state },
      after: { state: updated.state, countNote: updated.postNote },
    });
    return { count: toCountDto(updated), movementIds };
  },
});
