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
  uuid,
} from 'drizzle-orm/pg-core';
import { actors, archivable, timestamps } from './columns';
import { entities } from './entities';

/** The item master (INV-01, docs/DATABASE.md �§6.3). One catalogue shared by every entity. */
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
    isActive: boolean('is_active').notNull().default(true),
    ...archivable,
    ...timestamps,
    ...actors,
  },
  (t) => [
    check('items_hsn_check', sql`${t.hsn} ~ '^[0-9]{4,8}$'`),
    check(
      'items_unit_check',
      sql`${t.unit} in ('nos', 'set', 'metre', 'kg', 'litre', 'kw', 'hour')`,
    ),
    check(
      'items_category_check',
      sql`${t.category} in ('pump', 'motor', 'solar_module', 'controller', 'structure', 'cable', 'pipe', 'inverter', 'battery', 'other')`,
    ),
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
 * Cost side of an item per entity (restricted; docs/DATABASE.md §4.3). Read and written only with
 * `finance.cost.read`; Phase 3 decides how goods receipts post the moving average.
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
    asOf: timestamp('as_of', { withTimezone: true }),
    ...timestamps,
    ...actors,
  },
  (t) => [unique('item_costs_item_entity_unique').on(t.itemId, t.entityId)],
);
