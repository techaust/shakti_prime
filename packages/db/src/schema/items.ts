import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actors, archivable, timestamps } from './columns';
import { entities } from './entities';

/** The item master (INV-01, docs/05-database.md §6.3). One catalogue shared by every entity. */
export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey(),
    sku: text('sku').notNull().unique(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    hsn: text('hsn').notNull(),
    unit: text('unit').notNull().default('nos'),
    isSerialTracked: boolean('is_serial_tracked').notNull().default(false),
    isDcr: boolean('is_dcr').notNull().default(false),
    almmRef: text('almm_ref'),
    specsJson: jsonb('specs_json').notNull().default({}),
    // Stock and warranty (phase3 §6.1, C5).
    /** Months of warranty to the customer, from delivery; null when not set. */
    warrantyMonths: smallint('warranty_months'),
    /** Months of the supplier's warranty, from receipt; null when not set. */
    supplierWarrantyMonths: smallint('supplier_warranty_months'),
    /** The supplier's printed code, as a scanner reads it; unique where set. */
    barcode: text('barcode'),
    /** The unit the item is bought in; null means the stock unit (`unit`). */
    purchaseUnit: text('purchase_unit'),
    /** How many stock units one purchase unit holds (a coil of 100 metres: 100). */
    purchaseUnitFactor: numeric('purchase_unit_factor', { precision: 12, scale: 3 }),
    /** A JavaScript regular expression a scanned serial must match whole; serial-tracked items only. */
    serialPattern: text('serial_pattern'),
    /** False for a service or labour, which never reaches the stock ledger. */
    isStocked: boolean('is_stocked').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    ...archivable,
    ...timestamps,
    ...actors,
  },
  (t) => [
    check('items_hsn_check', sql`${t.hsn} ~ '^([0-9]{4}|[0-9]{6}|[0-9]{8})$'`),
    check(
      'items_unit_check',
      sql`${t.unit} in ('nos', 'set', 'metre', 'kg', 'litre', 'kw', 'hour')`,
    ),
    check(
      'items_category_check',
      sql`${t.category} in ('pump', 'motor', 'solar_module', 'controller', 'structure', 'cable', 'pipe', 'inverter', 'battery', 'other')`,
    ),
    check(
      'items_warranty_months_check',
      sql`(${t.warrantyMonths} is null or ${t.warrantyMonths} between 0 and 360) and (${t.supplierWarrantyMonths} is null or ${t.supplierWarrantyMonths} between 0 and 360)`,
    ),
    // Printable characters without spaces, as a scanner sends them.
    check('items_barcode_check', sql`${t.barcode} ~ '^[!-~]{4,64}$'`),
    check(
      'items_purchase_unit_check',
      sql`${t.purchaseUnit} in ('nos', 'set', 'metre', 'kg', 'litre', 'kw', 'hour')`,
    ),
    // A factor only with a purchase unit, required when that unit differs from the stock unit.
    check(
      'items_purchase_factor_check',
      sql`(${t.purchaseUnitFactor} is null or ${t.purchaseUnitFactor} >= 1) and (${t.purchaseUnit} is not null or ${t.purchaseUnitFactor} is null) and (${t.purchaseUnit} is null or ${t.purchaseUnit} = ${t.unit} or ${t.purchaseUnitFactor} is not null) and (${t.purchaseUnit} is distinct from ${t.unit} or ${t.purchaseUnitFactor} is null or ${t.purchaseUnitFactor} = 1)`,
    ),
    check(
      'items_serial_pattern_check',
      sql`${t.serialPattern} is null or (${t.isSerialTracked} and char_length(${t.serialPattern}) between 1 and 200)`,
    ),
    // Only a category the specifications mark as a possible service (`NON_STOCK_CATEGORIES`) may be
    // left out of stock, and then it has no serials.
    check(
      'items_stocked_check',
      sql`${t.isStocked} or (not ${t.isSerialTracked} and ${t.category} in ('other'))`,
    ),
    uniqueIndex('items_barcode_unique')
      .on(t.barcode)
      .where(sql`${t.barcode} is not null`),
    // The specifications of the category (`@shakti/contracts` catalogue/specs.ts), always an object.
    check('items_specs_object_check', sql`jsonb_typeof(${t.specsJson}) = 'object'`),
    index('items_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    index('items_category_idx').on(t.category),
  ],
);

/** Head-flow points of a pump; bounds are derived by the sizing calculator (SAL-04). */
export const pumpCurves = pgTable(
  'pump_curves',
  {
    id: uuid('id').primaryKey(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    headM: numeric('head_m', { precision: 8, scale: 2 }).notNull(),
    flowLph: numeric('flow_lph', { precision: 12, scale: 2 }).notNull(),
    ...timestamps,
    ...actors,
  },
  (t) => [
    unique('pump_curves_item_head_unique').on(t.itemId, t.headM),
    check('pump_curves_positive_check', sql`${t.headM} >= 0 and ${t.flowLph} >= 0`),
  ],
);

/**
 * Cost side of an item per entity (restricted; docs/05-database.md §4.3). Read and written only with
 * `finance.cost.read`, written only by the stock ledger's definer `app.stock_move()`.
 */
export const itemCosts = pgTable(
  'item_costs',
  {
    id: uuid('id').primaryKey(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    movingAvgCost: numeric('moving_avg_cost', { precision: 14, scale: 4 }),
    lastPurchaseRate: numeric('last_purchase_rate', { precision: 14, scale: 4 }),
    /**
     * The last moving average above zero (STOCK-2, question 2 (a)): what an inbound movement
     * without a cost takes while the company holds none of the item. Kept by `app.stock_move()`.
     */
    lastPositiveAvgCost: numeric('last_positive_avg_cost', { precision: 14, scale: 4 }),
    asOf: timestamp('as_of', { withTimezone: true }),
    ...timestamps,
    ...actors,
  },
  (t) => [unique('item_costs_item_entity_unique').on(t.itemId, t.entityId)],
);
