import {
  CancelStockCountInput,
  DomainError,
  newId,
  RecordStockCountInput,
  RecountStockCountInput,
  StartStockCountInput,
  StockCountDto,
  SubmitStockCountInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { assertEntityInScope } from '../imports/shared';
import { serialsOutsidePattern } from '../../catalogue/serial-pattern';
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
 * Stock counts (H3, docs/03-roadmap-appendix/phase3.md §7.3): the Inventory Manager starts a
 * count of a hub, chosen bins or chosen items and the expected quantities are frozen; counters
 * (`inventory.stock.move`) count blind, item by item in each bin, and send the count for review;
 * the Inventory Manager asks for any item in a bin again or cancels the count. Posting is
 * `counts-post.ts`. Every line is written by the count's definers; no command here reads an
 * expected quantity, and no audit row or answer carries one.
 */

/** `inventory.count.start`: a count of one company's stock in one hub (`inventory.stock.adjust`). */
export const startStockCount = defineCommand({
  name: 'inventory.count.start',
  permission: 'inventory.stock.adjust',
  minScope: 'entity',
  peopleOnly: true,
  input: StartStockCountInput,
  output: StockCountDto,
  auditFields: COUNT_AUDIT_FIELDS,
  constraintReasons: COUNT_CONSTRAINTS,
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const w = schema.warehouses;
    const [hub] = await ctx.tx
      .select({ id: w.id, kind: w.kind, archivedAt: w.archivedAt })
      .from(w)
      .where(eq(w.id, input.hubId))
      .limit(1);
    if (!hub) throw new DomainError('not_found', 'hub not found', { reason: 'hub_missing' });
    if (hub.archivedAt !== null) {
      throw new DomainError('conflict', 'hub archived', { reason: 'hub_archived' });
    }
    if (hub.kind === 'transit') {
      throw new DomainError('validation_failed', 'goods in transit are not counted', {
        reason: 'stock_count_hub_transit',
      });
    }
    if (input.binIds !== undefined) {
      const b = schema.bins;
      const found = await ctx.tx
        .select({ id: b.id })
        .from(b)
        .where(
          and(inArray(b.id, input.binIds), eq(b.warehouseId, hub.id), isNull(b.archivedAt)),
        );
      if (found.length !== input.binIds.length) {
        throw new DomainError('validation_failed', 'a bin outside the hub', {
          reason: 'stock_count_bin_outside',
        });
      }
    }
    if (input.itemIds !== undefined) {
      const i = schema.items;
      const found = await ctx.tx
        .select({ id: i.id })
        .from(i)
        .where(inArray(i.id, input.itemIds));
      if (found.length !== input.itemIds.length) {
        throw new DomainError('validation_failed', 'item not found', {
          reason: 'stock_item_missing',
        });
      }
    }
    const state = fireCount(ctx, { state: null, toCount: 0, recountOpen: 0 }, 'start');
    const [row] = await ctx.tx
      .insert(schema.stockCounts)
      .values({
        id: newId(),
        entityId: input.entityId,
        warehouseId: hub.id,
        scope: input.scope,
        scopeBinIds: input.binIds ?? null,
        scopeItemIds: input.itemIds ?? null,
        state,
        startedBy: ctx.principal.id,
        updatedBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'count insert returned no row');
    // The number of lines the start froze stays here: it is how much the ledger expects.
    await viaDefiner(() => ctx.tx.execute(sql`select app.stock_count_start(${row.id}::uuid)`));
    ctx.audit({
      aggregateType: 'stock_count',
      aggregateId: row.id,
      entityId: row.entityId,
      before: null,
      after: { state: row.state, countScope: row.scope },
    });
    return toCountDto(row);
  },
});

/**
 * `inventory.count.record`: a counter's count of one item in one bin, a quantity or every serial
 * found (`inventory.stock.move`). The first count moves the count to counting. A serial is
 * checked against the item's pattern before the definer looks it up.
 */
export const recordStockCount = defineCommand({
  name: 'inventory.count.record',
  permission: 'inventory.stock.move',
  minScope: 'entity',
  peopleOnly: true,
  input: RecordStockCountInput,
  output: StockCountDto,
  auditFields: COUNT_AUDIT_FIELDS,
  constraintReasons: COUNT_CONSTRAINTS,
  async handler(ctx, input) {
    const row = await lockCount(ctx, input.countId);
    let current = row;
    if (row.state === 'open') {
      const to = fireCount(ctx, { state: 'open', toCount: 0, recountOpen: 0 }, 'begin');
      current = await setCountState(ctx, row, to);
    } else if (row.state !== 'counting') {
      throw new DomainError('conflict', 'count not counting', {
        reason: 'stock_count_not_counting',
      });
    }
    if (input.serialNos !== undefined && input.serialNos.length > 0) {
      const i = schema.items;
      const [item] = await ctx.tx
        .select({ pattern: i.serialPattern })
        .from(i)
        .where(eq(i.id, input.itemId))
        .limit(1);
      const [outside] = serialsOutsidePattern(item?.pattern ?? null, input.serialNos);
      if (outside !== undefined) {
        throw new DomainError('validation_failed', 'serial outside the pattern', {
          reason: 'stock_count_serial_pattern',
          serialNo: outside,
        });
      }
    }
    const qty = input.qty ?? null;
    const serials = input.serialNos ?? null;
    // The serial numbers travel as a JSON array, so no character of one needs quoting.
    const serialsJson = serials === null ? null : JSON.stringify(serials);
    await viaDefiner(() =>
      ctx.tx.execute(
        sql`select app.stock_count_record(
              ${row.id}::uuid, ${input.binId}::uuid, ${input.itemId}::uuid, ${qty}::numeric,
              case when ${serialsJson}::jsonb is null then null::text[]
                   else array(select jsonb_array_elements_text(${serialsJson}::jsonb)) end)`,
      ),
    );
    ctx.audit({
      aggregateType: 'stock_count',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { state: row.state },
      after: {
        state: current.state,
        quantity: qty === null ? null : Number(qty),
        serialsCounted: serials === null ? null : serials.length,
      },
    });
    return toCountDto(current);
  },
});

/**
 * `inventory.count.recount`: ask for one item in one bin again (`inventory.stock.adjust`); a count
 * in review goes back to counting.
 */
export const recountStockCount = defineCommand({
  name: 'inventory.count.recount',
  permission: 'inventory.stock.adjust',
  minScope: 'entity',
  peopleOnly: true,
  input: RecountStockCountInput,
  output: StockCountDto,
  auditFields: COUNT_AUDIT_FIELDS,
  constraintReasons: COUNT_CONSTRAINTS,
  async handler(ctx, input) {
    const row = await lockCount(ctx, input.countId);
    const record = await countRecord(ctx, row);
    const to = fireCount(ctx, record, 'recount');
    const rows = (await viaDefiner(() =>
      ctx.tx.execute(
        sql`select app.stock_count_recount(${row.id}::uuid, ${input.binId}::uuid, ${input.itemId}::uuid) as asked`,
      ),
    )) as unknown as { asked: boolean }[];
    if (rows[0]?.asked !== true) {
      throw new DomainError('not_found', 'no such item in the bin', {
        reason: 'stock_count_line_missing',
      });
    }
    const updated = await setCountState(ctx, row, to);
    ctx.audit({
      aggregateType: 'stock_count',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { state: row.state },
      after: { state: updated.state },
    });
    return toCountDto(updated);
  },
});

/**
 * `inventory.count.submit`: send the count for review once every item in every bin is counted
 * (`inventory.stock.move`).
 */
export const submitStockCount = defineCommand({
  name: 'inventory.count.submit',
  permission: 'inventory.stock.move',
  minScope: 'entity',
  peopleOnly: true,
  input: SubmitStockCountInput,
  output: StockCountDto,
  auditFields: COUNT_AUDIT_FIELDS,
  constraintReasons: COUNT_CONSTRAINTS,
  async handler(ctx, input) {
    const row = await lockCount(ctx, input.countId);
    const record = await countRecord(ctx, row);
    const to = fireCount(ctx, record, 'submit');
    const updated = await setCountState(ctx, row, to, {
      submittedAt: ctx.now,
      submittedBy: ctx.principal.id,
    });
    ctx.audit({
      aggregateType: 'stock_count',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { state: row.state },
      after: { state: updated.state },
    });
    return toCountDto(updated);
  },
});

/** `inventory.count.cancel`: stop a count before it posts, with why (`inventory.stock.adjust`). */
export const cancelStockCount = defineCommand({
  name: 'inventory.count.cancel',
  permission: 'inventory.stock.adjust',
  minScope: 'entity',
  peopleOnly: true,
  input: CancelStockCountInput,
  output: StockCountDto,
  auditFields: COUNT_AUDIT_FIELDS,
  constraintReasons: COUNT_CONSTRAINTS,
  async handler(ctx, input) {
    const row = await lockCount(ctx, input.countId);
    const to = fireCount(
      ctx,
      { state: row.state as StockCountDto['state'], toCount: 0, recountOpen: 0 },
      'cancel',
    );
    const updated = await setCountState(ctx, row, to, {
      cancelledAt: ctx.now,
      cancelledBy: ctx.principal.id,
      cancelReason: input.cancelReason,
    });
    ctx.audit({
      aggregateType: 'stock_count',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { state: row.state },
      after: { state: updated.state, cancelReason: updated.cancelReason },
    });
    return toCountDto(updated);
  },
});
