import {
  AdjustStockInput,
  DomainError,
  REVERSIBLE_STOCK_REASONS,
  ReverseStockInput,
  StockMovedDto,
  TransferStockInput,
  type StockReason,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { assertEntityInScope } from '../imports/shared';
import { transition } from '../../state-machines/define-machine';
import {
  serialMachine,
  type SerialEvent,
  type SerialRecord,
} from '../../state-machines/machines/serial';
import { REVERSAL, TRANSFER, type StockMoveLine } from '../../stock/move';
import { postStockMoves } from '../../stock/post';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';

/**
 * Moving stock by hand (H1, docs/03-roadmap-appendix/phase3.md §6.2): a move between two bins of
 * a hub, a gain, loss or damage with its reason, and the reversal of a movement made in error.
 * Each posts through `app.stock_move()`, the ledger's one write path, which checks the grant
 * again, locks in the one order and keeps the balances, serials and moving average; each serial
 * is fired through the `serial` machine first. Audit rows and the event carry ids, quantities and
 * reasons, never a cost.
 */

const STOCK_AUDIT_FIELDS = ['stockReason', 'quantity', 'serialNo', 'adjustNote'] as const;

/** The two unique indexes a concurrent movement can meet. */
const STOCK_RACES = {
  serials_item_serial_no_unique: 'stock_serial_exists',
  stock_movements_reverses_unique: 'stock_already_reversed',
} as const;

interface ItemFacts {
  id: string;
  isSerialTracked: boolean;
}

async function itemFacts(ctx: CommandContext, itemId: string): Promise<ItemFacts> {
  const [item] = await ctx.tx
    .select({ id: schema.items.id, isSerialTracked: schema.items.isSerialTracked })
    .from(schema.items)
    .where(eq(schema.items.id, itemId))
    .limit(1);
  if (!item) {
    throw new DomainError('validation_failed', 'item not found', { reason: 'stock_item_missing' });
  }
  return item;
}

/** A quantity of an untracked item, or the serials of a tracked one, as the item needs. */
function assertWhat(
  item: ItemFacts,
  input: { qty?: string | undefined; serialNos?: string[] | undefined },
): void {
  if (item.isSerialTracked && input.serialNos === undefined) {
    throw new DomainError('validation_failed', 'serials needed', {
      reason: 'stock_serial_required',
    });
  }
  if (!item.isSerialTracked && input.serialNos !== undefined) {
    throw new DomainError('validation_failed', 'no serials for this item', {
      reason: 'stock_serial_untracked',
    });
  }
}

interface SerialFacts extends SerialRecord {
  id: string;
  serialNo: string;
}

/** The company's serials of an item by number (any case), as row security shows them. */
async function serialsByNumber(
  ctx: CommandContext,
  entityId: number,
  itemId: string,
  serialNos: readonly string[],
): Promise<Map<string, SerialFacts>> {
  const s = schema.serials;
  const rows = await ctx.tx
    .select({ id: s.id, serialNo: s.serialNo, state: s.state, binId: s.binId })
    .from(s)
    .where(
      and(
        eq(s.entityId, entityId),
        eq(s.itemId, itemId),
        inArray(
          sql`lower(${s.serialNo})`,
          serialNos.map((n) => n.toLowerCase()),
        ),
      ),
    );
  return new Map(
    rows.map((r) => [
      r.serialNo.toLowerCase(),
      { ...r, state: r.state as SerialFacts['state'] } satisfies SerialFacts,
    ]),
  );
}

function fire(
  ctx: CommandContext,
  record: SerialRecord,
  event: SerialEvent,
  fromBinId: string | null,
): void {
  transition(serialMachine, record, event, {
    actor: { kind: 'principal', principal: ctx.principal },
    now: ctx.now,
    params: { fromBinId },
  });
}

function unknownSerial(serialNo: string): DomainError {
  return new DomainError('validation_failed', 'serial not found', {
    reason: 'stock_serial_unknown',
    serialNo,
  });
}

/** `inventory.stock.transfer`: stock between two bins of one hub (`inventory.stock.move`). */
export const transferStock = defineCommand({
  name: 'inventory.stock.transfer',
  permission: 'inventory.stock.move',
  minScope: 'entity',
  peopleOnly: true,
  input: TransferStockInput,
  output: StockMovedDto,
  auditFields: STOCK_AUDIT_FIELDS,
  constraintReasons: STOCK_RACES,
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const item = await itemFacts(ctx, input.itemId);
    assertWhat(item, input);
    const b = schema.bins;
    const bins = await ctx.tx
      .select({ id: b.id, hubId: b.warehouseId })
      .from(b)
      .where(inArray(b.id, [input.fromBinId, input.toBinId]));
    const from = bins.find((x) => x.id === input.fromBinId);
    const to = bins.find((x) => x.id === input.toBinId);
    if (!from || !to) {
      throw new DomainError('validation_failed', 'bin not found', { reason: 'stock_bin_missing' });
    }
    if (from.hubId !== to.hubId) {
      throw new DomainError('validation_failed', 'bins of two hubs', {
        reason: 'stock_transfer_hubs_differ',
      });
    }
    const base = {
      reason: TRANSFER,
      entityId: input.entityId,
      itemId: item.id,
      fromBinId: from.id,
      toBinId: to.id,
    };
    if (input.serialNos === undefined) {
      const qty = input.qty ?? '0';
      return postStockMoves(
        ctx,
        input.entityId,
        [{ ...base, qty }],
        [{ stockReason: 'transfer', quantity: qty, serialNo: null }],
        null,
      );
    }
    const known = await serialsByNumber(ctx, input.entityId, item.id, input.serialNos);
    const lines: StockMoveLine[] = [];
    for (const serialNo of input.serialNos) {
      const serial = known.get(serialNo.toLowerCase());
      if (!serial) throw unknownSerial(serialNo);
      fire(ctx, serial, 'transfer', from.id);
      lines.push({ ...base, qty: '1', serialId: serial.id });
    }
    return postStockMoves(
      ctx,
      input.entityId,
      lines,
      input.serialNos.map((serialNo) => ({ stockReason: 'transfer', quantity: '1', serialNo })),
      null,
    );
  },
});

const ADJUSTMENT_REASON = {
  gain: 'adjust_gain',
  loss: 'adjust_loss',
  damage: 'damage',
} as const satisfies Record<string, StockReason>;

/**
 * `inventory.stock.adjust`: a gain, loss or damage in one bin with why, at most 300 characters; a
 * gain enters at the moving average, a loss or damage leaves at it. A tracked item names its
 * serials: a gain makes a new serial, or brings back one written off.
 */
export const adjustStock = defineCommand({
  name: 'inventory.stock.adjust',
  permission: 'inventory.stock.adjust',
  minScope: 'entity',
  peopleOnly: true,
  input: AdjustStockInput,
  output: StockMovedDto,
  auditFields: STOCK_AUDIT_FIELDS,
  constraintReasons: STOCK_RACES,
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const item = await itemFacts(ctx, input.itemId);
    assertWhat(item, input);
    const reason = ADJUSTMENT_REASON[input.adjustment];
    const gain = input.adjustment === 'gain';
    const base = {
      reason,
      entityId: input.entityId,
      itemId: item.id,
      ...(gain ? { toBinId: input.binId } : { fromBinId: input.binId }),
      note: input.note,
    };
    if (input.serialNos === undefined) {
      const qty = input.qty ?? '0';
      return postStockMoves(
        ctx,
        input.entityId,
        [{ ...base, qty }],
        [{ stockReason: reason, quantity: qty, serialNo: null }],
        input.note,
      );
    }
    const known = await serialsByNumber(ctx, input.entityId, item.id, input.serialNos);
    const lines: StockMoveLine[] = [];
    for (const serialNo of input.serialNos) {
      const serial = known.get(serialNo.toLowerCase());
      if (gain) {
        if (serial === undefined) {
          fire(ctx, { state: null, binId: null }, 'stock_in', null);
          lines.push({ ...base, qty: '1', serialNo });
          continue;
        }
        if (serial.state !== 'scrapped') {
          throw new DomainError('conflict', 'serial held', {
            reason: 'stock_serial_exists',
            serialNo,
          });
        }
        fire(ctx, serial, 'reinstate', null);
        lines.push({ ...base, qty: '1', serialId: serial.id });
        continue;
      }
      if (!serial) throw unknownSerial(serialNo);
      fire(ctx, serial, 'scrap', input.binId);
      lines.push({ ...base, qty: '1', serialId: serial.id });
    }
    return postStockMoves(
      ctx,
      input.entityId,
      lines,
      input.serialNos.map((serialNo) => ({ stockReason: reason, quantity: '1', serialNo })),
      input.note,
    );
  },
});

const REVERSIBLE: ReadonlySet<string> = new Set(REVERSIBLE_STOCK_REASONS);
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `inventory.stock.reverse`: a movement made in error, undone within
 * `WORKSHOP_DEFAULTS.stock.reversalDays` by its mirror at its own cost. Never a reversal, never a
 * receipt or an issue (their own documents reverse them), never twice.
 */
export const reverseStock = defineCommand({
  name: 'inventory.stock.reverse',
  permission: 'inventory.stock.adjust',
  minScope: 'entity',
  peopleOnly: true,
  input: ReverseStockInput,
  output: StockMovedDto,
  auditFields: STOCK_AUDIT_FIELDS,
  constraintReasons: STOCK_RACES,
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const m = schema.stockMovements;
    const [original] = await ctx.tx
      .select({
        id: m.id,
        reason: m.reason,
        qty: m.qty,
        serialId: m.serialId,
        fromBinId: m.fromBinId,
        toBinId: m.toBinId,
        movedAt: m.movedAt,
        reversed: sql<boolean>`exists (select 1 from stock_movements r where r.reverses_id = ${m.id})`,
      })
      .from(m)
      .where(and(eq(m.id, input.movementId), eq(m.entityId, input.entityId)))
      .limit(1);
    if (!original) {
      throw new DomainError('not_found', 'movement not found', {
        reason: 'stock_movement_missing',
      });
    }
    if (!REVERSIBLE.has(original.reason)) {
      throw new DomainError('conflict', 'not reversed by hand', {
        reason: 'stock_reversal_not_allowed',
      });
    }
    if (original.reversed) {
      throw new DomainError('conflict', 'already reversed', { reason: 'stock_already_reversed' });
    }
    const days = WORKSHOP_DEFAULTS.stock.reversalDays;
    if (ctx.now.getTime() - original.movedAt.getTime() > days * DAY_MS) {
      throw new DomainError('conflict', 'too old to reverse', {
        reason: 'stock_reversal_too_old',
        days,
      });
    }
    let serialNo: string | null = null;
    if (original.serialId !== null) {
      const s = schema.serials;
      const [serial] = await ctx.tx
        .select({ state: s.state, binId: s.binId, serialNo: s.serialNo })
        .from(s)
        .where(eq(s.id, original.serialId))
        .limit(1);
      if (!serial) throw unknownSerial('');
      serialNo = serial.serialNo;
      const record = { state: serial.state as SerialRecord['state'], binId: serial.binId };
      if (original.fromBinId === null) fire(ctx, record, 'scrap', original.toBinId);
      else if (original.toBinId === null) fire(ctx, record, 'reinstate', null);
      else fire(ctx, record, 'transfer', original.toBinId);
    }
    return postStockMoves(
      ctx,
      input.entityId,
      [{ reason: REVERSAL, reversesId: original.id, note: input.note ?? null }],
      [{ stockReason: 'reversal', quantity: original.qty, serialNo }],
      input.note ?? null,
    );
  },
});
