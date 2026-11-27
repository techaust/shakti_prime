import {
  DomainError,
  GoodsReceiptRefDto,
  newId,
  PostGoodsReceiptInput,
  ReverseGoodsReceiptInput,
  type PurchaseOrderState,
  type StockReason,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { serialMatchesPattern } from '../../catalogue/serial-pattern';
import { toScaled } from '../../money/paise';
import { nextDocumentNo } from '../../numbering/next-document-no';
import { stockMovedPayload } from '../../stock/events';
import { stockRefusal } from '../../stock/move';
import {
  lockOrder,
  ORDER_CONSTRAINT_REASONS,
  orderLines,
  orderRecord,
  orderTransition,
  setOrderState,
  type LineRow,
  type OrderRow,
} from './po-shared';

/**
 * Goods receipts (docs/03-roadmap-appendix/phase3.md §7.2, INV-04): posted against a sent purchase
 * order with `procurement.grn.write`, every serial of a tracked item scanned or typed, matching the
 * item's pattern, new for the item and counted against the quantity; the goods move into stock
 * through `app.goods_receipt_post()`, which takes the order's rate to the ledger without the person
 * posting it reading it. Reversed whole, while none of its stock or serials has moved on. No
 * audit value, event or answer carries a rate.
 */

const RECEIPT_AUDIT_FIELDS = [
  'grnNo',
  'state',
  'lineCount',
  'vendorInvoiceNo',
  'vendorInvoiceDate',
  'reverseReason',
  'stockReason',
  'quantity',
  'serialNo',
] as const;

const RECEIPT_CONSTRAINT_REASONS = {
  ...ORDER_CONSTRAINT_REASONS,
  goods_receipt_posted: 'goods_receipt_posted',
  goods_receipt_reversed: 'goods_receipt_reversed',
  goods_receipt_moved_on: 'goods_receipt_moved_on',
  goods_receipt_serials_count: 'goods_receipt_serial_missing',
  goods_receipt_serial_taken: 'goods_receipt_serial_taken',
  goods_receipts_entity_no_unique: 'goods_receipt_number_taken',
} as const;

const RECEIVING_KINDS: readonly string[] = ['receiving', 'storage', 'quarantine'];

/** `a × b` of two three-decimal quantities, kept at three decimals (the stock unit's scale). */
function stockQty(qty: string, factor: string): string {
  const milli = (toScaled(qty, 3) * toScaled(factor, 3) + 500n) / 1000n;
  const text = milli.toString().padStart(4, '0');
  return `${text.slice(0, -3)}.${text.slice(-3)}`;
}

function wholeUnits(qty: string): number | undefined {
  const scaled = toScaled(qty, 3);
  return scaled % 1000n === 0n ? Number(scaled / 1000n) : undefined;
}

/** A ledger refusal, else the error itself. */
async function viaLedger<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    throw stockRefusal(e) ?? e;
  }
}

/** The bins a receipt may go into: in the order's hub, in use, of a kind goods are received into. */
async function receiptBins(
  ctx: CommandContext,
  hubId: string,
): Promise<{ receiving: string | undefined; usable: Set<string> }> {
  const b = schema.bins;
  const rows = await ctx.tx
    .select({ id: b.id, kind: b.kind })
    .from(b)
    .where(and(eq(b.warehouseId, hubId), isNull(b.archivedAt), inArray(b.kind, [...RECEIVING_KINDS])));
  return {
    receiving: rows.find((r) => r.kind === 'receiving')?.id,
    usable: new Set(rows.map((r) => r.id)),
  };
}

/** One movement's audit row, as the stock commands write them: never a cost. */
async function auditMovements(ctx: CommandContext, entityId: number, movementIds: string[]): Promise<void> {
  if (movementIds.length === 0) return;
  const rows = (await ctx.tx.execute(sql`
    select m.id, m.reason, m.qty::text as qty, s.serial_no as "serialNo"
      from stock_movements m
      left join serials s on s.id = m.serial_id
     where m.id = any (${`{${movementIds.join(',')}}`}::uuid[])`)) as unknown as {
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

async function emitMoved(ctx: CommandContext, entityId: number, movementIds: string[]): Promise<void> {
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

interface CheckedLine {
  line: LineRow;
  qty: string;
  stockQty: string;
  binId: string;
  tracked: boolean;
  serialNos: string[];
}

/** Each receipt line against its order line: quantity, bin and every serial. */
async function checkLines(
  ctx: CommandContext,
  order: OrderRow,
  lines: readonly PostGoodsReceiptInput['lines'][number][],
): Promise<CheckedLine[]> {
  const orderLinesById = new Map((await orderLines(ctx, order.id)).map((l) => [l.id, l]));
  const i = schema.items;
  const items = new Map(
    (
      await ctx.tx
        .select({ id: i.id, isSerialTracked: i.isSerialTracked, serialPattern: i.serialPattern })
        .from(i)
        .where(
          inArray(
            i.id,
            [...orderLinesById.values()].map((l) => l.itemId),
          ),
        )
    ).map((r) => [r.id, r]),
  );
  const bins = await receiptBins(ctx, order.deliverToWarehouseId);
  const checked: CheckedLine[] = [];
  for (const input of lines) {
    const line = orderLinesById.get(input.poLineId);
    const item = line === undefined ? undefined : items.get(line.itemId);
    if (line === undefined || item === undefined) {
      throw new DomainError('validation_failed', `line ${input.poLineId} is not on the order`, {
        reason: 'goods_receipt_line_unknown',
      });
    }
    if (toScaled(input.qty, 3) > toScaled(line.qty, 3) - toScaled(line.qtyReceived, 3)) {
      throw new DomainError('validation_failed', 'more than the order still expects', {
        reason: 'goods_receipt_over_order',
        itemId: line.itemId,
      });
    }
    const binId = input.binId ?? bins.receiving;
    if (binId === undefined || !bins.usable.has(binId)) {
      throw new DomainError('validation_failed', 'the bin is not one goods are received into at the hub', {
        reason: 'goods_receipt_bin_unusable',
        itemId: line.itemId,
      });
    }
    const units = stockQty(input.qty, line.unitFactor);
    const serialNos = (input.serialNos ?? []).map((s) => s.trim());
    if (!item.isSerialTracked) {
      if (serialNos.length > 0) {
        throw new DomainError('validation_failed', 'the item has no serials', {
          reason: 'goods_receipt_serials_untracked',
          itemId: line.itemId,
        });
      }
    } else {
      const count = wholeUnits(units);
      if (count === undefined) {
        throw new DomainError('validation_failed', 'a serial-tracked item comes in whole units', {
          reason: 'goods_receipt_whole_units',
          itemId: line.itemId,
        });
      }
      const seen = new Set<string>();
      for (const serialNo of serialNos) {
        const key = serialNo.toLowerCase();
        if (seen.has(key)) {
          throw new DomainError('validation_failed', 'a serial is given twice', {
            reason: 'goods_receipt_serial_repeated',
            itemId: line.itemId,
            serialNo,
          });
        }
        seen.add(key);
        if (!serialMatchesPattern(item, serialNo)) {
          throw new DomainError('validation_failed', 'a serial does not fit the item', {
            reason: 'goods_receipt_serial_pattern',
            itemId: line.itemId,
            serialNo,
          });
        }
      }
      if (serialNos.length < count) {
        throw new DomainError('validation_failed', 'a serial of the line is missing', {
          reason: 'goods_receipt_serial_missing',
          itemId: line.itemId,
          missing: count - serialNos.length,
        });
      }
      if (serialNos.length > count) {
        throw new DomainError('validation_failed', 'more serials than units', {
          reason: 'goods_receipt_serial_extra',
          itemId: line.itemId,
          extra: serialNos.length - count,
        });
      }
    }
    checked.push({
      line,
      qty: input.qty,
      stockQty: units,
      binId,
      tracked: item.isSerialTracked,
      serialNos,
    });
  }
  return checked;
}

/** Each order line's received quantity after the change, and whether every line is in full. */
function receivedAfter(
  lines: readonly LineRow[],
  change: ReadonlyMap<string, bigint>,
): { qty: Map<string, string>; full: boolean; none: boolean } {
  const qty = new Map<string, string>();
  let full = true;
  let none = true;
  for (const line of lines) {
    const next = toScaled(line.qtyReceived, 3) + (change.get(line.id) ?? 0n);
    const text = next.toString().padStart(4, '0');
    qty.set(line.id, `${text.slice(0, -3)}.${text.slice(-3)}`);
    if (next < toScaled(line.qty, 3)) full = false;
    if (next > 0n) none = false;
  }
  return { qty, full, none };
}

async function companyCode(ctx: CommandContext, entityId: number): Promise<string> {
  const [row] = await ctx.tx
    .select({ code: schema.entities.code })
    .from(schema.entities)
    .where(eq(schema.entities.id, entityId))
    .limit(1);
  if (!row) throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  return row.code;
}

/** `procurement.grn.post`: goods received against a sent order, into stock at the order's rate. */
export const postGoodsReceipt = defineCommand({
  name: 'procurement.grn.post',
  permission: 'procurement.grn.write',
  minScope: 'entity',
  peopleOnly: true,
  input: PostGoodsReceiptInput,
  output: GoodsReceiptRefDto,
  auditFields: RECEIPT_AUDIT_FIELDS,
  constraintReasons: RECEIPT_CONSTRAINT_REASONS,
  async handler(ctx, input) {
    const order = await lockOrder(ctx, input.purchaseOrderId);
    const checked = await checkLines(ctx, order, input.lines);
    const lines = await orderLines(ctx, order.id);
    const after = receivedAfter(
      lines,
      new Map(checked.map((c) => [c.line.id, toScaled(c.qty, 3)])),
    );
    const record = await orderRecord(ctx, order);
    const to = orderTransition(ctx, record, after.full ? 'receive_all' : 'receive');

    const number = await nextDocumentNo(
      ctx,
      order.entityId,
      await companyCode(ctx, order.entityId),
      'goods_receipt',
    );
    const receiptId = newId();
    await ctx.tx.insert(schema.goodsReceipts).values({
      id: receiptId,
      entityId: order.entityId,
      grnNo: number.formatted,
      poId: order.id,
      warehouseId: order.deliverToWarehouseId,
      state: 'posted',
      receivedAt: ctx.now,
      receivedBy: ctx.principal.id,
      vendorInvoiceNo: input.vendorInvoiceNo ?? null,
      vendorInvoiceDate: input.vendorInvoiceDate ?? null,
      createdBy: ctx.principal.id,
    });
    const serials: Record<string, string[]> = {};
    for (const c of checked) {
      const lineId = newId();
      await ctx.tx.insert(schema.goodsReceiptLines).values({
        id: lineId,
        receiptId,
        entityId: order.entityId,
        poLineId: c.line.id,
        itemId: c.line.itemId,
        binId: c.binId,
        qty: c.qty,
        stockQty: c.stockQty,
        isSerialTracked: c.tracked,
        createdBy: ctx.principal.id,
      });
      if (c.tracked) serials[lineId] = c.serialNos;
    }
    const movementIds = await viaLedger(async () => {
      const rows = (await ctx.tx.execute(
        sql`select app.goods_receipt_post(${receiptId}::uuid, ${JSON.stringify(serials)}::jsonb) as ids`,
      )) as unknown as { ids: string[] }[];
      return rows[0]?.ids ?? [];
    });
    for (const c of checked) {
      await ctx.tx
        .update(schema.poLines)
        .set({ qtyReceived: after.qty.get(c.line.id) ?? c.line.qtyReceived, updatedBy: ctx.principal.id })
        .where(eq(schema.poLines.id, c.line.id));
    }
    await setOrderState(ctx, order, to);

    ctx.audit({
      aggregateType: 'goods_receipt',
      aggregateId: receiptId,
      entityId: order.entityId,
      before: null,
      after: {
        grnNo: number.formatted,
        state: 'posted',
        lineCount: checked.length,
        vendorInvoiceNo: input.vendorInvoiceNo ?? null,
        vendorInvoiceDate: input.vendorInvoiceDate ?? null,
        purchaseOrderId: order.id,
      },
    });
    ctx.audit({
      aggregateType: 'purchase_order',
      aggregateId: order.id,
      entityId: order.entityId,
      before: { state: order.state },
      after: { state: to },
    });
    await auditMovements(ctx, order.entityId, movementIds);
    await emitMoved(ctx, order.entityId, movementIds);
    ctx.emit({
      type: 'procurement.receipt.posted',
      entityId: order.entityId,
      aggregateType: 'goods_receipt',
      aggregateId: receiptId,
      payload: { purchaseOrderId: order.id, lineCount: checked.length, fullyReceived: after.full },
    });
    return {
      id: receiptId,
      entityId: order.entityId,
      grnNo: number.formatted,
      purchaseOrderId: order.id,
      state: 'posted' as const,
      purchaseOrderState: to,
      movementCount: movementIds.length,
    };
  },
});

/**
 * `procurement.grn.reverse`: a whole receipt taken back out of stock, with a reason, while none of
 * its stock or serials has moved on (`app.goods_receipt_unpost()` checks and reverses each
 * movement, which takes the receipt's cost back out of the moving average). The order goes back to
 * what is still received.
 */
export const reverseGoodsReceipt = defineCommand({
  name: 'procurement.grn.reverse',
  permission: 'procurement.grn.write',
  minScope: 'entity',
  peopleOnly: true,
  input: ReverseGoodsReceiptInput,
  output: GoodsReceiptRefDto,
  auditFields: RECEIPT_AUDIT_FIELDS,
  constraintReasons: RECEIPT_CONSTRAINT_REASONS,
  async handler(ctx, input) {
    const r = schema.goodsReceipts;
    const [receipt] = await ctx.tx
      .select()
      .from(r)
      .where(eq(r.id, input.receiptId))
      .limit(1)
      .for('update');
    if (!receipt || !ctx.entityIds.includes(receipt.entityId)) {
      throw new DomainError('not_found', `goods receipt ${input.receiptId} is not readable`, {
        reason: 'goods_receipt_missing',
      });
    }
    if (receipt.state !== 'posted') {
      throw new DomainError('conflict', 'the goods receipt is already reversed', {
        reason: 'goods_receipt_reversed',
      });
    }
    const order = await lockOrder(ctx, receipt.poId);
    const gl = schema.goodsReceiptLines;
    const receiptLines = await ctx.tx
      .select({ poLineId: gl.poLineId, qty: gl.qty })
      .from(gl)
      .where(eq(gl.receiptId, receipt.id));
    const lines = await orderLines(ctx, order.id);
    const after = receivedAfter(
      lines,
      new Map(receiptLines.map((l) => [l.poLineId, -toScaled(l.qty, 3)])),
    );
    const to: PurchaseOrderState = orderTransition(
      ctx,
      await orderRecord(ctx, order),
      after.none ? 'unreceive' : 'unreceive_part',
    );
    const movementIds = await viaLedger(async () => {
      const rows = (await ctx.tx.execute(
        sql`select app.goods_receipt_unpost(${receipt.id}::uuid) as ids`,
      )) as unknown as { ids: string[] }[];
      return rows[0]?.ids ?? [];
    });
    for (const l of receiptLines) {
      await ctx.tx
        .update(schema.poLines)
        .set({ qtyReceived: after.qty.get(l.poLineId), updatedBy: ctx.principal.id })
        .where(eq(schema.poLines.id, l.poLineId));
    }
    await setOrderState(ctx, order, to);
    await ctx.tx
      .update(r)
      .set({
        state: 'reversed',
        reversedAt: ctx.now,
        reversedBy: ctx.principal.id,
        reverseReason: input.reason,
        updatedBy: ctx.principal.id,
      })
      .where(eq(r.id, receipt.id));

    ctx.audit({
      aggregateType: 'goods_receipt',
      aggregateId: receipt.id,
      entityId: receipt.entityId,
      before: { state: 'posted', reverseReason: null },
      after: { state: 'reversed', reverseReason: input.reason },
    });
    ctx.audit({
      aggregateType: 'purchase_order',
      aggregateId: order.id,
      entityId: order.entityId,
      before: { state: order.state },
      after: { state: to },
    });
    await auditMovements(ctx, receipt.entityId, movementIds);
    await emitMoved(ctx, receipt.entityId, movementIds);
    ctx.emit({
      type: 'procurement.receipt.reversed',
      entityId: receipt.entityId,
      aggregateType: 'goods_receipt',
      aggregateId: receipt.id,
      payload: { purchaseOrderId: order.id },
    });
    return {
      id: receipt.id,
      entityId: receipt.entityId,
      grnNo: receipt.grnNo,
      purchaseOrderId: order.id,
      state: 'reversed' as const,
      purchaseOrderState: to,
      movementCount: movementIds.length,
    };
  },
});
