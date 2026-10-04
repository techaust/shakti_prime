import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorsRequired, archivable, timestamps } from './columns';
import { entities } from './entities';
import { opportunities } from './opportunities';
import { principals } from './principals';

/**
 * A free label a team puts on leads to filter and group them (docs/DATABASE.md §6.2): a scheme, an
 * exhibition, a village drive. `entity_id` null is a tag for the whole group. A name is unique in
 * its company, whatever its case (`tags_entity_name_unique`, with nulls not distinct, written in
 * the migration because drizzle-kit cannot express it).
 */
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id').references(() => entities.id),
    name: text('name').notNull(),
    ...archivable,
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [check('tags_name_length_check', sql`char_length(${t.name}) between 1 and 40`)],
);

/**
 * A tag on a lead. Follows the child-table template: a composite key to the lead, so the row is
 * always in the lead's company, and a tag of one company never goes on another company's lead
 * (the insert policy).
 */
export const opportunityTags = pgTable(
  'opportunity_tags',
  {
    opportunityId: uuid('opportunity_id').notNull(),
    /** The lead's own customer, by the composite key, as `tasks` carries it. */
    accountId: uuid('account_id').notNull(),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
  },
  (t) => [
    primaryKey({ name: 'opportunity_tags_pkey', columns: [t.opportunityId, t.tagId] }),
    foreignKey({
      name: 'opportunity_tags_opportunity_fk',
      columns: [t.opportunityId, t.entityId, t.accountId],
      foreignColumns: [opportunities.id, opportunities.entityId, opportunities.accountId],
    }),
    index('opportunity_tags_tag_idx').on(t.tagId),
  ],
);
