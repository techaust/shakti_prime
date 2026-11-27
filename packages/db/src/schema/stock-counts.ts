import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './columns';
import { entities } from './entities';
import { items } from './items';
import { principals } from './principals';
import { bins, serials, warehouses } from './stock';

/** A quantity in the item's stock unit, as the ledger keeps it. */
const quantity = (name: string) => numeric(name, { precision: 12, scale: 3 });

/**
 * A stock count of one company's stock in one hub (H3, docs/03-roadmap-appendix/phase3.md §7.3):
 * the whole hub, chosen bins or chosen items. Its state follows the `stock-count` machine; at most
 * one count is live per company and hub, so two counts never post the same variance twice.
 */
export const stockCounts = pgTable(
  'stock_counts',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    scope: text('scope').notNull(),
    /** The bins of a `bins` count; null for any other scope. */
    scopeBinIds: uuid('scope_bin_ids').array(),
    /** The items of an `items` count; null for any other scope. */
    scopeItemIds: uuid('scope_item_ids').array(),
    state: text('state').notNull(),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    startedBy: uuid('started_by')
      .notNull()
      .references(() => principals.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedBy: uuid('submitted_by').references(() => principals.id),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    postedBy: uuid('posted_by').references(() => principals.id),
    /** Why the posted write-offs happened, recorded on each movement the count posted. */
    postNote: text('post_note'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: uuid('cancelled_by').references(() => principals.id),
    cancelReason: text('cancel_reason'),
    updatedBy: uuid('updated_by').references(() => principals.id),
    ...timestamps,
  },
  (t) => [
    unique('stock_counts_id_entity_unique').on(t.id, t.entityId),
    check(
      'stock_counts_state_check',
      sql`${t.state} in ('open', 'counting', 'review', 'posted', 'cancelled')`,
    ),
    check('stock_counts_scope_check', sql`${t.scope} in ('hub', 'bins', 'items')`),
    check(
      'stock_counts_scope_lists_check',
      sql`(${t.scope} = 'hub' and ${t.scopeBinIds} is null and ${t.scopeItemIds} is null)
          or (${t.scope} = 'bins' and cardinality(${t.scopeBinIds}) between 1 and 200 and ${t.scopeItemIds} is null)
          or (${t.scope} = 'items' and cardinality(${t.scopeItemIds}) between 1 and 200 and ${t.scopeBinIds} is null)`,
    ),
    check(
      'stock_counts_posted_check',
      sql`(${t.state} = 'posted') = (${t.postedAt} is not null and ${t.postedBy} is not null and ${t.postNote} is not null)`,
    ),
    check(
      'stock_counts_cancelled_check',
      sql`(${t.state} = 'cancelled') = (${t.cancelledAt} is not null and ${t.cancelledBy} is not null and ${t.cancelReason} is not null)`,
    ),
    check(
      'stock_counts_notes_check',
      sql`(${t.postNote} is null or char_length(${t.postNote}) between 3 and 300)
          and (${t.cancelReason} is null or char_length(${t.cancelReason}) between 3 and 300)`,
    ),
    // One live count per company and hub.
    uniqueIndex('stock_counts_live_unique')
      .on(t.entityId, t.warehouseId)
      .where(sql`${t.state} in ('open', 'counting', 'review')`),
    // `/inventory/counts`: a company's counts by state, newest first.
    index('stock_counts_list_idx').on(t.entityId, t.state, t.startedAt.desc(), t.id.desc()),
    index('stock_counts_warehouse_idx').on(t.warehouseId),
  ],
);

/**
 * One line of a count: an untracked item in a bin, or one serial of a tracked item in a bin.
 * `expected_qty` is frozen when the count starts (by `app.stock_count_start()`, or when a counter
 * adds a line the start did not list) and no request role selects it: the Inventory Manager reads
 * it only through `app.stock_count_review()`, which checks `inventory.stock.adjust`. Every line
 * is written only by the count's definers.
 */
export const stockCountLines = pgTable(
  'stock_count_lines',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    countId: uuid('count_id').notNull(),
    binId: uuid('bin_id')
      .notNull()
      .references(() => bins.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    serialId: uuid('serial_id'),
    expectedQty: quantity('expected_qty').notNull(),
    countedQty: quantity('counted_qty'),
    countedBy: uuid('counted_by').references(() => principals.id),
    countedAt: timestamp('counted_at', { withTimezone: true }),
    recountRequestedAt: timestamp('recount_requested_at', { withTimezone: true }),
    recountRequestedBy: uuid('recount_requested_by').references(() => principals.id),
    recountQty: quantity('recount_qty'),
    recountedBy: uuid('recounted_by').references(() => principals.id),
    recountedAt: timestamp('recounted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'stock_count_lines_count_fk',
      columns: [t.countId, t.entityId],
      foreignColumns: [stockCounts.id, stockCounts.entityId],
    }),
    foreignKey({
      name: 'stock_count_lines_serial_fk',
      columns: [t.serialId, t.entityId, t.itemId],
      foreignColumns: [serials.id, serials.entityId, serials.itemId],
    }),
    check(
      'stock_count_lines_qty_check',
      sql`${t.expectedQty} >= 0 and coalesce(${t.countedQty}, 0) >= 0 and coalesce(${t.recountQty}, 0) >= 0`,
    ),
    // A serial's line counts it there or not: one or none.
    check(
      'stock_count_lines_serial_qty_check',
      sql`${t.serialId} is null
          or (${t.expectedQty} in (0, 1) and coalesce(${t.countedQty}, 0) in (0, 1)
              and coalesce(${t.recountQty}, 0) in (0, 1))`,
    ),
    check(
      'stock_count_lines_counted_check',
      sql`(${t.countedQty} is null) = (${t.countedAt} is null)
          and (${t.countedQty} is null) = (${t.countedBy} is null)`,
    ),
    check(
      'stock_count_lines_recount_check',
      sql`(${t.recountQty} is null) = (${t.recountedAt} is null)
          and (${t.recountQty} is null) = (${t.recountedBy} is null)
          and (${t.recountRequestedAt} is null) = (${t.recountRequestedBy} is null)
          and (${t.recountQty} is null or ${t.recountRequestedAt} is not null)`,
    ),
    // One line per untracked item in a bin, and per serial in a bin.
    uniqueIndex('stock_count_lines_item_unique')
      .on(t.countId, t.binId, t.itemId)
      .where(sql`${t.serialId} is null`),
    uniqueIndex('stock_count_lines_serial_unique')
      .on(t.countId, t.binId, t.serialId)
      .where(sql`${t.serialId} is not null`),
    index('stock_count_lines_group_idx').on(t.countId, t.binId, t.itemId),
    index('stock_count_lines_serial_idx')
      .on(t.countId, t.serialId)
      .where(sql`${t.serialId} is not null`),
  ],
);
