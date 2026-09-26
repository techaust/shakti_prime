import { sql } from 'drizzle-orm';
import { boolean, check, numeric, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { actors, archivable, timestamps } from './columns';
import { items } from './items';

/** A saleable bundle of items (INV-03). Availability-to-promise is a Phase 3 calculator. */
export const kits = pgTable('kits', {
  id: uuid('id').primaryKey(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  nameHi: text('name_hi').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  ...archivable,
  ...timestamps,
  ...actors,
});

export const kitComponents = pgTable(
  'kit_components',
  {
    id: uuid('id').primaryKey(),
    kitId: uuid('kit_id')
      .notNull()
      .references(() => kits.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    qty: numeric('qty', { precision: 12, scale: 3 }).notNull(),
    ...timestamps,
    ...actors,
  },
  (t) => [
    unique('kit_components_kit_item_unique').on(t.kitId, t.itemId),
    check('kit_components_qty_check', sql`${t.qty} > 0`),
  ],
);
