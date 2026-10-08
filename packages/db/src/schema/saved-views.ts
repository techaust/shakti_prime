import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './columns';
import { principals } from './principals';

/**
 * A person's saved views of a grid (docs/08-design-system.md §6): the hidden columns, sort, filters and row
 * height under a name of their own. Each person reads and writes only their own views, whatever
 * company they work in (migration 0045); nobody else, the reporting role included, sees them.
 */
export const savedViews = pgTable(
  'saved_views',
  {
    id: uuid('id').primaryKey(),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id),
    screen: text('screen').notNull(),
    name: text('name').notNull(),
    settingsJson: jsonb('settings_json').notNull(),
    ...timestamps,
  },
  (t) => [
    check(
      'saved_views_screen_check',
      sql`${t.screen} in ('leads', 'team_members', 'price_lists', 'imports', 'catalogue_items', 'catalogue_kits', 'customers')`,
    ),
    check(
      'saved_views_name_check',
      sql`char_length(${t.name}) between 1 and 60 and ${t.name} = btrim(${t.name})`,
    ),
    check('saved_views_settings_check', sql`jsonb_typeof(${t.settingsJson}) = 'object'`),
    // Also the index for the owner's foreign key and for listing one screen's views.
    unique('saved_views_name_unique').on(t.principalId, t.screen, t.name),
  ],
);
