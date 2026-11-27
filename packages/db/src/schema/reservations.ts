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
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './columns';
import { entities } from './entities';
import { items } from './items';
import { principals } from './principals';
import { salesOrderLines, salesOrders } from './sales-orders';
import { bins, warehouses } from './stock';

/** A quantity in the item's stock unit, as the ledger keeps it. */
const quantity = (name: string) => numeric(name, { precision: 12, scale: 3 });

/**
 * What a confirmed order line needs of one item (H2, docs/03-roadmap-appendix/phase3.md §7.1): an
 * item line needs its item, a kit line each component at the kit's quantity when the order was
 * confirmed, so a later change to the kit leaves the order as it was sold. `qty_backordered` is
 * what no reservation covers yet; backorders fill in `queued_at` order, which is the order's
 * confirmation, or the moment a reservation lapsed or was released by hand (it then waits behind
 * the backorders already queued, for stock that arrives after it: `requeued_at`). Written only by
 * the reservation definers.
 *
 * Its rows go with their order: orders are never deleted by a request, and the suites remove
 * theirs whole.
 */
export const reservationNeeds = pgTable(
  'reservation_needs',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    salesOrderId: uuid('sales_order_id').notNull(),
    salesOrderLineId: uuid('sales_order_line_id')
      .notNull()
      .references(() => salesOrderLines.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    qtyNeeded: quantity('qty_needed').notNull(),
    qtyBackordered: quantity('qty_backordered').notNull(),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull(),
    /**
     * When a lapse or a release by hand put the need back on order; null for a need queued at
     * confirmation. Such a need is filled only by stock that entered a storage bin after this
     * moment (a receipt, a gain, a transfer in), at most that much, never by the stock its own
     * lapse or release freed.
     */
    requeuedAt: timestamp('requeued_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique('reservation_needs_line_item_unique').on(t.salesOrderLineId, t.itemId),
    foreignKey({
      name: 'reservation_needs_order_fk',
      columns: [t.salesOrderId, t.entityId],
      foreignColumns: [salesOrders.id, salesOrders.entityId],
    }).onDelete('cascade'),
    check('reservation_needs_qty_check', sql`${t.qtyNeeded} > 0`),
    check(
      'reservation_needs_backordered_check',
      sql`${t.qtyBackordered} >= 0 and ${t.qtyBackordered} <= ${t.qtyNeeded}`,
    ),
    index('reservation_needs_order_idx').on(t.salesOrderId),
    // The backorder queue of an item in a company, oldest first.
    index('reservation_needs_queue_idx')
      .on(t.entityId, t.itemId, t.queuedAt, t.id)
      .where(sql`${t.qtyBackordered} > 0`),
    index('reservation_needs_item_idx').on(t.itemId),
  ],
);

/**
 * Stock set aside for an order line (H2, docs/03-roadmap-appendix/phase3.md §7.1, question 3 (a)):
 * a quantity of one item in one storage bin of a hub, held until `expires_at`. A kit line reserves
 * each component. The `reservation` machine documents the states. While a reservation is active
 * its quantity counts in its bin's `stock_balances.qty_reserved`, which only
 * `app.stock_reserve()` and `app.stock_unreserve()` change; nothing else writes this table.
 */
export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    salesOrderId: uuid('sales_order_id').notNull(),
    salesOrderLineId: uuid('sales_order_line_id').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    binId: uuid('bin_id').notNull(),
    qty: quantity('qty').notNull(),
    state: text('state').notNull().default('active'),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** When the reminder before it lapses was sent; once per reservation and extension. */
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    /** Extended once, by whom, when and why. */
    extendedBy: uuid('extended_by').references(() => principals.id),
    extendedAt: timestamp('extended_at', { withTimezone: true }),
    extendReason: text('extend_reason'),
    /** Why it was released: by hand, with the order's cancellation, or moved to another hub. */
    releaseKind: text('release_kind'),
    releasedReason: text('released_reason'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
    updatedBy: uuid('updated_by').references(() => principals.id),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'reservations_order_fk',
      columns: [t.salesOrderId, t.entityId],
      foreignColumns: [salesOrders.id, salesOrders.entityId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'reservations_need_fk',
      columns: [t.salesOrderLineId, t.itemId],
      foreignColumns: [reservationNeeds.salesOrderLineId, reservationNeeds.itemId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'reservations_bin_fk',
      columns: [t.binId, t.warehouseId],
      foreignColumns: [bins.id, bins.warehouseId],
    }),
    check('reservations_qty_check', sql`${t.qty} > 0`),
    check(
      'reservations_state_check',
      sql`${t.state} in ('active', 'picked', 'released', 'lapsed')`,
    ),
    check(
      'reservations_extended_check',
      sql`(${t.extendedBy} is null) = (${t.extendedAt} is null)
          and (${t.extendedBy} is null) = (${t.extendReason} is null)
          and (${t.extendReason} is null or char_length(btrim(${t.extendReason})) between 1 and 300)`,
    ),
    check(
      'reservations_release_kind_check',
      sql`${t.releaseKind} is null or ${t.releaseKind} in ('by_hand', 'order_cancelled', 'moved')`,
    ),
    // A released reservation says how; a person's release and a cancellation say why.
    check(
      'reservations_released_check',
      sql`(${t.state} = 'released') = (${t.releaseKind} is not null)
          and (${t.releasedReason} is null or (${t.releaseKind} in ('by_hand', 'order_cancelled')
               and char_length(btrim(${t.releasedReason})) between 1 and 300))`,
    ),
    // What a bin holds for orders: the balance's `qty_reserved` is their sum.
    index('reservations_active_bin_idx')
      .on(t.entityId, t.binId, t.itemId)
      .where(sql`${t.state} = 'active'`),
    index('reservations_order_idx').on(t.salesOrderId),
    index('reservations_line_idx').on(t.salesOrderLineId, t.itemId),
    // The daily scan: active reservations of a company by when they lapse.
    index('reservations_expiry_idx')
      .on(t.entityId, t.expiresAt)
      .where(sql`${t.state} = 'active'`),
    // The item's stock card: its active reservations.
    index('reservations_item_idx')
      .on(t.entityId, t.itemId)
      .where(sql`${t.state} = 'active'`),
    index('reservations_warehouse_idx').on(t.warehouseId),
    index('reservations_bin_idx').on(t.binId),
  ],
);
