import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
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
import { items } from './items';
import { kits } from './kits';
import { principals } from './principals';

/** Price tiers (docs/01-blueprint.md §8.3): retail, dealer, commercial, extensible from Admin. */
export const priceTiers = pgTable('price_tiers', {
  id: uuid('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  ...archivable,
  ...timestamps,
  ...actors,
});

/** A versioned, effective-dated price list per tier, shared or per entity (SAL-01). */
export const priceLists = pgTable(
  'price_lists',
  {
    id: uuid('id').primaryKey(),
    tierId: uuid('tier_id')
      .notNull()
      .references(() => priceTiers.id),
    entityId: smallint('entity_id').references(() => entities.id),
    version: integer('version').notNull().default(1),
    effectiveFrom: date('effective_from').notNull(),
    effectiveTo: date('effective_to'),
    /** Set with `approved_at` by `pricing.list.approve`; a list prices nothing before it. */
    approvedBy: uuid('approved_by').references(() => principals.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    ...archivable,
    ...timestamps,
    ...actors,
  },
  (t) => [
    unique('price_lists_tier_entity_version_unique')
      .on(t.tierId, t.entityId, t.version)
      .nullsNotDistinct(),
    check(
      'price_lists_effective_check',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    check('price_lists_approval_check', sql`(${t.approvedBy} is null) = (${t.approvedAt} is null)`),
  ],
);

/** One price per item or kit on a list. Prices are never edited elsewhere (CLAUDE.md). */
export const priceListItems = pgTable(
  'price_list_items',
  {
    id: uuid('id').primaryKey(),
    priceListId: uuid('price_list_id')
      .notNull()
      .references(() => priceLists.id),
    itemId: uuid('item_id').references(() => items.id),
    kitId: uuid('kit_id').references(() => kits.id),
    price: numeric('price', { precision: 14, scale: 2 }).notNull(),
    ...timestamps,
    ...actors,
  },
  (t) => [
    unique('price_list_items_list_item_unique').on(t.priceListId, t.itemId),
    unique('price_list_items_list_kit_unique').on(t.priceListId, t.kitId),
    index('price_list_items_item_idx').on(t.itemId),
    index('price_list_items_kit_idx').on(t.kitId),
    check('price_list_items_target_check', sql`(${t.itemId} is null) <> (${t.kitId} is null)`),
    check('price_list_items_price_check', sql`${t.price} >= 0`),
  ],
);

/** Append-only price history (docs/05-database.md §5). No update columns by design. */
export const priceChangeLog = pgTable(
  'price_change_log',
  {
    id: uuid('id').primaryKey(),
    priceListItemId: uuid('price_list_item_id')
      .notNull()
      .references(() => priceListItems.id),
    oldPrice: numeric('old_price', { precision: 14, scale: 2 }),
    newPrice: numeric('new_price', { precision: 14, scale: 2 }).notNull(),
    reason: text('reason'),
    changedBy: uuid('changed_by')
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('price_change_log_item_idx').on(t.priceListItemId, t.createdAt)],
);
