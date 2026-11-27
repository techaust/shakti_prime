import {
  DomainError,
  newId,
  TaxRateRowSchema,
  type PurchaseOrderLineInput,
  type PurchaseOrderRefDto,
  type PurchaseOrderState,
  type TaxRateRow,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { istCalendarDate } from '../../numbering/financial-year';
import { poLineAmount, purchaseOrderTotals } from '../../procurement/po-totals';
import { readsRates } from '../../queries/procurement/vendor-read';
import {
  purchaseOrderMachine,
  type PurchaseOrderEvent,
  type PurchaseOrderParams,
  type PurchaseOrderRecord,
} from '../../state-machines/machines/purchase-order';
import { transition } from '../../state-machines/define-machine';
import { toPaise } from '../../money/paise';
import { resolveRate } from '../../tax';

/** A purchase order row as the commands read it. */
export type OrderRow = typeof schema.purchaseOrders.$inferSelect;
/** A line row as the commands read it. */
export type LineRow = typeof schema.poLines.$inferSelect;

/** The catalogue reasons of the database's own refusals, for the commands' `constraintReasons`. */
export const ORDER_CONSTRAINT_REASONS = {
  purchase_order_not_draft: 'purchase_order_not_draft',
  purchase_order_not_open: 'purchase_order_not_open',
  purchase_order_transition_not_allowed: 'purchase_order_transition_not_allowed',
  po_self_approval: 'po_self_approval',
  po_lines_incomplete: 'po_lines_incomplete',
  purchase_orders_entity_no_unique: 'purchase_order_number_taken',
  po_lines_received_check: 'goods_receipt_over_order',
} as const;

/** The order, locked for the change, in the request's companies; `purchase_order_missing` else. */
export async function lockOrder(ctx: CommandContext, purchaseOrderId: string): Promise<OrderRow> {
  const [row] = await ctx.tx
    .select()
    .from(schema.purchaseOrders)
    .where(eq(schema.purchaseOrders.id, purchaseOrderId))
    .limit(1)
    .for('update');
  if (!row || !ctx.entityIds.includes(row.entityId)) {
    throw new DomainError('not_found', `purchase order ${purchaseOrderId} is not readable`, {
      reason: 'purchase_order_missing',
    });
  }
  return row;
}

export async function orderLines(ctx: CommandContext, purchaseOrderId: string): Promise<LineRow[]> {
  return ctx.tx
    .select()
    .from(schema.poLines)
    .where(eq(schema.poLines.poId, purchaseOrderId))
    .orderBy(schema.poLines.lineNo);
}

/** The lines' rates, read under the caller's own `procurement.rate.read`; empty without it. */
export async function orderRates(
  ctx: CommandContext,
  lineIds: readonly string[],
): Promise<Map<string, { unitRate: string; amount: string; quoteId: string | null }>> {
  if (lineIds.length === 0 || !readsRates(ctx.principal)) return new Map();
  const r = schema.poLineRates;
  const rows = await ctx.tx
    .select({ poLineId: r.poLineId, unitRate: r.unitRate, amount: r.amount, quoteId: r.quoteId })
    .from(r)
    .where(inArray(r.poLineId, [...lineIds]));
  return new Map(rows.map((row) => [row.poLineId, row]));
}

/** What the machine reads of an order: its lines and, for a reader of rates, its grand total. */
export async function orderRecord(
  ctx: CommandContext,
  row: OrderRow,
): Promise<PurchaseOrderRecord> {
  const lines = await orderLines(ctx, row.id);
  const rates = await orderRates(
    ctx,
    lines.map((l) => l.id),
  );
  const complete = lines.length > 0 && lines.every((l) => l.taxRatePct !== null && rates.has(l.id));
  const totals = complete
    ? purchaseOrderTotals(
        lines.map((l) => ({
          amount: rates.get(l.id)?.amount ?? null,
          taxRatePct: l.taxRatePct,
          taxRateId: l.taxRateId,
        })),
        {
          vendorStateCode: row.vendorStateCode,
          placeOfSupplyStateCode: row.placeOfSupplyStateCode,
        },
      )
    : null;
  return {
    state: row.state as PurchaseOrderState,
    lineCount: lines.length,
    linesComplete: complete,
    grandTotalPaise: totals === null ? null : toPaise(totals.grandTotal),
    draftedBy: row.draftedBy,
  };
}

/** Fires an event of the purchase order machine as the caller (refusals as the machine words them). */
export function orderTransition(
  ctx: CommandContext,
  record: PurchaseOrderRecord,
  event: PurchaseOrderEvent,
  params: PurchaseOrderParams = {},
): PurchaseOrderState {
  return transition(purchaseOrderMachine, record, event, {
    actor: { kind: 'principal', principal: ctx.principal },
    now: ctx.now,
    params,
  }).to;
}

/** Moves an order to a state the machine answered, as the caller. */
export async function setOrderState(
  ctx: CommandContext,
  row: OrderRow,
  to: PurchaseOrderState,
  extra: Partial<typeof schema.purchaseOrders.$inferInsert> = {},
): Promise<void> {
  await ctx.tx
    .update(schema.purchaseOrders)
    .set({ state: to, stateChangedAt: ctx.now, updatedBy: ctx.principal.id, ...extra })
    .where(eq(schema.purchaseOrders.id, row.id));
}

export function orderRef(
  row: Pick<OrderRow, 'id' | 'entityId' | 'poNo'>,
  state: string,
): PurchaseOrderRefDto {
  return { id: row.id, entityId: row.entityId, poNo: row.poNo, state: state as PurchaseOrderState };
}

/** The vendor an order goes to: active, with its GST state. */
export async function activeVendor(
  ctx: CommandContext,
  vendorId: string,
): Promise<{ id: string; stateCode: string | null }> {
  const [vendor] = await ctx.tx
    .select({
      id: schema.vendors.id,
      stateCode: schema.vendors.stateCode,
      isActive: schema.vendors.isActive,
    })
    .from(schema.vendors)
    .where(eq(schema.vendors.id, vendorId))
    .limit(1);
  if (!vendor) {
    throw new DomainError('not_found', `vendor ${vendorId} is not readable`, {
      reason: 'vendor_missing',
    });
  }
  if (!vendor.isActive) {
    throw new DomainError('conflict', `vendor ${vendorId} is archived`, {
      reason: 'purchase_order_vendor_inactive',
    });
  }
  return { id: vendor.id, stateCode: vendor.stateCode };
}

/** The hub goods are delivered to: a godown or factory in use, with its state (the place of supply). */
export async function deliveryHub(
  ctx: CommandContext,
  warehouseId: string,
): Promise<{ id: string; stateCode: string }> {
  const w = schema.warehouses;
  const [hub] = await ctx.tx
    .select({ id: w.id, kind: w.kind, stateCode: w.stateCode, archivedAt: w.archivedAt })
    .from(w)
    .where(eq(w.id, warehouseId))
    .limit(1);
  const stateCode = hub?.archivedAt === null && hub.kind !== 'transit' ? hub.stateCode : null;
  if (hub === undefined || stateCode === null) {
    throw new DomainError('validation_failed', `hub ${warehouseId} does not take deliveries`, {
      reason: 'purchase_order_hub_unusable',
    });
  }
  return { id: hub.id, stateCode };
}

interface ItemFacts {
  id: string;
  hsn: string;
  unit: string;
  purchaseUnit: string | null;
  purchaseUnitFactor: string | null;
}

/** The items of the lines: in the catalogue, active and stocked. */
async function orderItems(
  ctx: CommandContext,
  itemIds: readonly string[],
): Promise<Map<string, ItemFacts>> {
  const i = schema.items;
  const rows = await ctx.tx
    .select({
      id: i.id,
      hsn: i.hsn,
      unit: i.unit,
      purchaseUnit: i.purchaseUnit,
      purchaseUnitFactor: i.purchaseUnitFactor,
      isActive: i.isActive,
      archivedAt: i.archivedAt,
      isStocked: i.isStocked,
    })
    .from(i)
    .where(inArray(i.id, [...itemIds]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const itemId of itemIds) {
    const item = byId.get(itemId);
    if (!item || !item.isActive || item.archivedAt !== null || !item.isStocked) {
      throw new DomainError('validation_failed', `item ${itemId} cannot be bought into stock`, {
        reason: 'purchase_order_item_unusable',
        itemId,
      });
    }
  }
  return new Map(rows.map((r) => [r.id, r]));
}

/** The GST rate in force today for each item (its own row, else its HSN's); null where none is. */
export async function lineTaxRates(
  ctx: Pick<CommandContext, 'tx' | 'now'>,
  items: readonly { id: string; hsn: string }[],
): Promise<Map<string, TaxRateRow | null>> {
  if (items.length === 0) return new Map();
  const tr = schema.taxRates;
  const rows = await ctx.tx
    .select({
      id: tr.id,
      hsn: tr.hsn,
      itemId: tr.itemId,
      ratePct: tr.ratePct,
      effectiveFrom: tr.effectiveFrom,
      effectiveTo: tr.effectiveTo,
    })
    .from(tr)
    .where(
      or(
        inArray(
          tr.itemId,
          items.map((x) => x.id),
        ),
        and(isNull(tr.itemId), inArray(tr.hsn, [...new Set(items.map((x) => x.hsn))])),
      ),
    );
  const rates = rows.map((r) => TaxRateRowSchema.parse(r));
  const out = new Map<string, TaxRateRow | null>();
  for (const item of items) {
    try {
      out.set(item.id, resolveRate(rates, { hsn: item.hsn, itemId: item.id, on: ctx.now }));
    } catch (e) {
      if (e instanceof DomainError && e.details?.reason === 'tax_rate_missing')
        out.set(item.id, null);
      else throw e;
    }
  }
  return out;
}

/**
 * The vendor's valid quote rate for each item, for the order's company or the group, read under
 * the caller's own `procurement.rate.read` (row security on `vendor_quotes`): of the live quotes on
 * the day in India, the company's own before the group's, the lowest rate first.
 */
async function quoteRates(
  ctx: CommandContext,
  entityId: number,
  vendorId: string,
  itemIds: readonly string[],
): Promise<Map<string, { quoteId: string; rate: string }>> {
  if (itemIds.length === 0) return new Map();
  const q = schema.vendorQuotes;
  const day = istCalendarDate(ctx.now);
  const rows = await ctx.tx
    .select({ id: q.id, itemId: q.itemId, rate: q.rate, entityId: q.entityId })
    .from(q)
    .where(
      and(
        eq(q.vendorId, vendorId),
        inArray(q.itemId, [...itemIds]),
        isNull(q.withdrawnAt),
        sql`${q.validFrom} <= ${day}::date and ${q.validUntil} >= ${day}::date`,
        or(eq(q.entityId, entityId), isNull(q.entityId)),
      ),
    )
    .orderBy(sql`${q.entityId} is null`, q.rate);
  const out = new Map<string, { quoteId: string; rate: string }>();
  for (const row of rows) {
    if (!out.has(row.itemId)) out.set(row.itemId, { quoteId: row.id, rate: row.rate });
  }
  return out;
}

/** Refuses a typed or quoted rate from a caller without `procurement.rate.read`. */
export function assertRatesAllowed(
  ctx: CommandContext,
  lines: readonly PurchaseOrderLineInput[],
): void {
  const asks = lines.some(
    (l) => (l.rate !== undefined && l.rate !== null) || l.rateFromQuote === true,
  );
  if (asks && !readsRates(ctx.principal)) {
    throw new DomainError('forbidden', 'a rate needs procurement.rate.read', {
      reason: 'procurement_rate_required',
      permission: 'procurement.rate.read',
    });
  }
}

/** A rate the caller kept from the line it replaces. */
export interface KeptRate {
  unitRate: string;
  quoteId: string | null;
}

/**
 * Writes a draft's lines as the input lists them, numbered in order: each item's purchase unit,
 * factor and HSN from the catalogue, its GST rate from the tax engine, and its rate typed, filled
 * from the vendor's quote or kept (`kept`, by item) under the caller's own grant. Answers how many
 * lines were written.
 */
export async function writeLines(
  ctx: CommandContext,
  order: { id: string; entityId: number; vendorId: string },
  lines: readonly PurchaseOrderLineInput[],
  kept: ReadonlyMap<string, KeptRate> = new Map(),
): Promise<number> {
  assertRatesAllowed(ctx, lines);
  const itemIds = lines.map((l) => l.itemId);
  const items = await orderItems(ctx, itemIds);
  const taxes = await lineTaxRates(ctx, [...items.values()]);
  const quoted = lines.some((l) => l.rateFromQuote === true)
    ? await quoteRates(
        ctx,
        order.entityId,
        order.vendorId,
        lines.filter((l) => l.rateFromQuote === true).map((l) => l.itemId),
      )
    : new Map<string, { quoteId: string; rate: string }>();

  for (const [index, line] of lines.entries()) {
    const item = items.get(line.itemId);
    if (item === undefined) throw new DomainError('internal', 'an order item went missing');
    const tax = taxes.get(item.id) ?? null;
    const lineId = newId();
    await ctx.tx.insert(schema.poLines).values({
      id: lineId,
      poId: order.id,
      entityId: order.entityId,
      lineNo: index + 1,
      itemId: item.id,
      qty: line.qty,
      purchaseUnit: item.purchaseUnit ?? item.unit,
      unitFactor: item.purchaseUnitFactor ?? '1',
      hsn: item.hsn,
      taxRateId: tax?.id ?? null,
      taxRatePct: tax?.ratePct ?? null,
      createdBy: ctx.principal.id,
    });

    let rate: KeptRate | undefined;
    if (line.rateFromQuote === true) {
      const quote = quoted.get(item.id);
      if (quote === undefined) {
        throw new DomainError('validation_failed', `no live quote of the vendor for ${item.id}`, {
          reason: 'po_quote_missing',
          itemId: item.id,
        });
      }
      rate = { unitRate: quote.rate, quoteId: quote.quoteId };
    } else if (line.rate !== undefined && line.rate !== null) {
      rate = { unitRate: line.rate, quoteId: null };
    } else if (line.rate === undefined) {
      rate = kept.get(item.id);
    }
    if (rate !== undefined) {
      await ctx.tx.insert(schema.poLineRates).values({
        poLineId: lineId,
        entityId: order.entityId,
        unitRate: rate.unitRate,
        amount: poLineAmount(line.qty, rate.unitRate),
        quoteId: rate.quoteId,
        createdBy: ctx.principal.id,
      });
    }
  }
  return lines.length;
}
