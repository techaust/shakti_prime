import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { actors, archivable, timestamps } from './columns';

/** Where leads come from (docs/01-blueprint.md §2, docs/05-database.md §6.2). Shared by all entities. */
export const leadSources = pgTable(
  'lead_sources',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    channel: text('channel').notNull(),
    costModel: text('cost_model'),
    isActive: boolean('is_active').notNull().default(true),
    ...archivable,
    ...timestamps,
    ...actors,
  },
  (t) => [
    check(
      'lead_sources_channel_check',
      sql`${t.channel} in ('meta_ads', 'google_ads', 'website', 'whatsapp', 'ivr', 'missed_call', 'walk_in', 'referral', 'import', 'manual')`,
    ),
  ],
);
