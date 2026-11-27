import { sql } from 'drizzle-orm';
import {
  check,
  date,
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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { accounts, customerSites } from './accounts';
import { actorsRequired, archivable, timestamps } from './columns';
import { entities } from './entities';
import { items } from './items';
import { principals } from './principals';

/** A quantity in the item's stock unit (docs/03-roadmap-appendix/phase3.md §5). */
const quantity = (name: string) => numeric(name, { precision: 12, scale: 3 });

/**
 * A hub (docs/03-roadmap-appendix/phase3.md §5, question 1 (a)): shared by the group, so both
 * sites hold several companies' stock side by side. A godown or factory has its address, state
 * code and PIN code; the transit hub holds goods between two hubs and has none of its own.
 */
export const warehouses = pgTable(
  'warehouses',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    address: text('address'),
    stateCode: text('state_code'),
    pinCode: text('pin_code'),
    /**
     * The PIN codes this hub serves first (H2): an order whose site's PIN code is listed here
     * reserves from this hub before any other. Empty until the client names which hub serves which
     * districts.
     */
    pinCodes: text('pin_codes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...archivable,
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    uniqueIndex('warehouses_code_unique').on(sql`lower(${t.code})`),
    check('warehouses_kind_check', sql`${t.kind} in ('godown', 'factory', 'transit')`),
    check('warehouses_code_check', sql`${t.code} ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,19}$'`),
    check(
      'warehouses_state_code_check',
      sql`${t.stateCode} is null or ${t.stateCode} ~ '^[0-9]{2}$'`,
    ),
    check(
      'warehouses_pin_code_check',
      sql`${t.pinCode} is null or ${t.pinCode} ~ '^[1-9][0-9]{5}$'`,
    ),
    check(
      'warehouses_pin_codes_check',
      sql`array_to_string(${t.pinCodes}, ',') ~ '^([1-9][0-9]{5}(,[1-9][0-9]{5})*)?$' and cardinality(${t.pinCodes}) <= 2000`,
    ),
    check(
      'warehouses_site_check',
      sql`${t.kind} = 'transit' or (${t.stateCode} is not null and ${t.pinCode} is not null)`,
    ),
  ],
);

/**
 * A bin of a hub, its code unique in the hub. Every godown and factory has one `receiving` and one
 * `dispatch` bin; the transit hub has one `transit` bin per pair of hubs (`pair_a`, `pair_b`, in
 * id order), which only those two hubs move stock into and out of.
 */
export const bins = pgTable(
  'bins',
  {
    id: uuid('id').primaryKey(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    code: text('code').notNull(),
    kind: text('kind').notNull(),
    pairAWarehouseId: uuid('pair_a_warehouse_id').references(() => warehouses.id),
    pairBWarehouseId: uuid('pair_b_warehouse_id').references(() => warehouses.id),
    ...archivable,
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    uniqueIndex('bins_warehouse_code_unique').on(t.warehouseId, sql`lower(${t.code})`),
    unique('bins_id_warehouse_unique').on(t.id, t.warehouseId),
    check(
      'bins_kind_check',
      sql`${t.kind} in ('storage', 'receiving', 'dispatch', 'quarantine', 'surplus', 'transit')`,
    ),
    check('bins_code_check', sql`${t.code} ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,40}$'`),
    check(
      'bins_pair_check',
      sql`(${t.kind} = 'transit') = (${t.pairAWarehouseId} is not null and ${t.pairBWarehouseId} is not null)
          and (${t.pairAWarehouseId} is null or ${t.pairAWarehouseId} < ${t.pairBWarehouseId})`,
    ),
    // One receiving and one dispatch bin per hub while it is in use.
    uniqueIndex('bins_warehouse_kind_unique')
      .on(t.warehouseId, t.kind)
      .where(sql`${t.kind} in ('receiving', 'dispatch') and ${t.archivedAt} is null`),
    // One transit bin per pair.
    uniqueIndex('bins_pair_unique')
      .on(t.warehouseId, t.pairAWarehouseId, t.pairBWarehouseId)
      .where(sql`${t.kind} = 'transit'`),
  ],
);

/**
 * A serial of a serial-tracked item, owned by one company (question 1 (a)). Its state and bin are
 * kept in step with its movements by `app.stock_move()`; nothing else writes them. The `serial`
 * machine documents the states.
 */
export const serials = pgTable(
  'serials',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    serialNo: text('serial_no').notNull(),
    state: text('state').notNull(),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    binId: uuid('bin_id').references(() => bins.id),
    accountId: uuid('account_id').references(() => accounts.id),
    siteId: uuid('site_id').references(() => customerSites.id),
    /** The supplier (U1's vendors); the foreign key arrives with that table. */
    vendorId: uuid('vendor_id'),
    /** The goods receipt line it came in on (U2); the foreign key arrives with that table. */
    receiptLineId: uuid('receipt_line_id'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    warrantyUntil: date('warranty_until'),
    supplierWarrantyUntil: date('supplier_warranty_until'),
    dcrValidatedAt: timestamp('dcr_validated_at', { withTimezone: true }),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    uniqueIndex('serials_item_serial_no_unique').on(t.itemId, sql`lower(${t.serialNo})`),
    unique('serials_id_entity_item_unique').on(t.id, t.entityId, t.itemId),
    check(
      'serials_state_check',
      sql`${t.state} in ('in_stock', 'reserved', 'picked', 'in_transit', 'with_customer', 'faulty', 'with_supplier', 'scrapped')`,
    ),
    check(
      'serials_serial_no_check',
      sql`${t.serialNo} = btrim(${t.serialNo}) and char_length(${t.serialNo}) between 1 and 100`,
    ),
    // In a bin while the company holds it; in none once it has left.
    check(
      'serials_bin_check',
      sql`(${t.state} in ('in_stock', 'reserved', 'picked', 'faulty') and ${t.binId} is not null)
          or (${t.state} in ('with_customer', 'with_supplier', 'scrapped') and ${t.binId} is null)
          or ${t.state} = 'in_transit'`,
    ),
    index('serials_entity_item_idx').on(t.entityId, t.itemId),
    index('serials_bin_idx')
      .on(t.binId)
      .where(sql`${t.binId} is not null`),
  ],
);

/**
 * The stock ledger (append-only, docs/03-roadmap-appendix/phase3.md §5): one row per movement of
 * a quantity of an item, or of one serial, from a bin, into a bin, or between two. Written only by
 * `app.stock_move()`; a correction is a reversal and a new movement.
 */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    serialId: uuid('serial_id'),
    fromBinId: uuid('from_bin_id').references(() => bins.id),
    toBinId: uuid('to_bin_id').references(() => bins.id),
    qty: quantity('qty').notNull(),
    reason: text('reason').notNull(),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    reversesId: uuid('reverses_id').references((): AnyPgColumn => stockMovements.id),
    /** Why a person moved it: an adjustment's reason, or a reversal's. */
    note: text('note'),
    /** The movements of one `app.stock_move()` call share it (an import posts one batch). */
    batchId: uuid('batch_id').notNull(),
    movedAt: timestamp('moved_at', { withTimezone: true }).notNull().defaultNow(),
    movedBy: uuid('moved_by')
      .notNull()
      .references(() => principals.id),
    requestId: text('request_id'),
  },
  (t) => [
    unique('stock_movements_id_entity_unique').on(t.id, t.entityId),
    foreignKey({
      name: 'stock_movements_serial_fk',
      columns: [t.serialId, t.entityId, t.itemId],
      foreignColumns: [serials.id, serials.entityId, serials.itemId],
    }),
    check('stock_movements_qty_check', sql`${t.qty} > 0`),
    check(
      'stock_movements_bins_check',
      sql`(${t.fromBinId} is not null or ${t.toBinId} is not null)
          and ${t.fromBinId} is distinct from ${t.toBinId}`,
    ),
    check('stock_movements_serial_qty_check', sql`${t.serialId} is null or ${t.qty} = 1`),
    check(
      'stock_movements_reason_check',
      sql`${t.reason} in ('opening', 'receipt', 'transfer', 'pick', 'issue', 'return_customer', 'return_supplier', 'adjust_gain', 'adjust_loss', 'damage', 'count', 'warranty_replacement', 'surplus_in', 'surplus_out', 'reversal')`,
    ),
    check(
      'stock_movements_reversal_check',
      sql`(${t.reason} = 'reversal') = (${t.reversesId} is not null)`,
    ),
    check('stock_movements_ref_check', sql`(${t.refType} is null) = (${t.refId} is null)`),
    check(
      'stock_movements_note_check',
      sql`${t.note} is null or char_length(${t.note}) between 1 and 300`,
    ),
    // A movement is reversed at most once.
    uniqueIndex('stock_movements_reverses_unique')
      .on(t.reversesId)
      .where(sql`${t.reversesId} is not null`),
    // The item's stock card, newest first.
    index('stock_movements_card_idx').on(t.entityId, t.itemId, t.movedAt.desc()),
    index('stock_movements_from_bin_idx')
      .on(t.fromBinId, t.movedAt.desc())
      .where(sql`${t.fromBinId} is not null`),
    index('stock_movements_to_bin_idx')
      .on(t.toBinId, t.movedAt.desc())
      .where(sql`${t.toBinId} is not null`),
    index('stock_movements_serial_idx')
      .on(t.serialId, t.movedAt.desc())
      .where(sql`${t.serialId} is not null`),
    index('stock_movements_ref_idx')
      .on(t.refType, t.refId)
      .where(sql`${t.refId} is not null`),
    index('stock_movements_batch_idx').on(t.batchId),
    index('stock_movements_opening_idx')
      .on(t.entityId)
      .where(sql`${t.reason} = 'opening'`),
  ],
);

/**
 * Each movement's unit cost (restricted, append-only; `finance.cost.read`): the moving average or
 * the given cost of an inbound movement, the moving average of an outbound one, the original
 * movement's of a reversal. Written only by `app.stock_move()` beside its movement.
 */
export const stockMovementCosts = pgTable(
  'stock_movement_costs',
  {
    movementId: uuid('movement_id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    unitCost: numeric('unit_cost', { precision: 14, scale: 4 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'stock_movement_costs_movement_fk',
      columns: [t.movementId, t.entityId],
      foreignColumns: [stockMovements.id, stockMovements.entityId],
    }),
    check('stock_movement_costs_unit_cost_check', sql`${t.unitCost} >= 0`),
  ],
);

/**
 * What a company holds of an item in a bin (INV-02): kept by `app.stock_move()` in the movement's
 * transaction, never written by a command; every balance equals the sum of its movements
 * (`app.stock_balance_check()`). The hub is the bin's, kept here for the lock order and the lists.
 */
export const stockBalances = pgTable(
  'stock_balances',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    binId: uuid('bin_id').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    qtyOnHand: quantity('qty_on_hand').notNull().default('0'),
    qtyReserved: quantity('qty_reserved').notNull().default('0'),
    lastMovedAt: timestamp('last_moved_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // The lock order of every stock path: company, hub, bin, item.
    unique('stock_balances_key_unique').on(t.entityId, t.warehouseId, t.binId, t.itemId),
    foreignKey({
      name: 'stock_balances_bin_fk',
      columns: [t.binId, t.warehouseId],
      foreignColumns: [bins.id, bins.warehouseId],
    }),
    check('stock_balances_on_hand_check', sql`${t.qtyOnHand} >= 0`),
    check('stock_balances_reserved_check', sql`${t.qtyReserved} >= 0`),
    // Reserved never exceeds what the bin holds (H2): `app.stock_move()` refuses an outbound line
    // that would take it there, and the reservation definers reserve only free stock.
    check('stock_balances_reserved_on_hand_check', sql`${t.qtyReserved} <= ${t.qtyOnHand}`),
    index('stock_balances_entity_item_idx').on(t.entityId, t.itemId),
    index('stock_balances_bin_idx').on(t.binId),
  ],
);
