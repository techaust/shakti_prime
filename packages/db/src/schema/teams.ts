import { index, pgTable, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { actors, archivable, timestamps } from './columns';
import { entities } from './entities';
import { principals } from './principals';

/** Caller teams for the team scope (docs/DATABASE.md §6.1). `entity_id` null means shared. */
export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id').references(() => entities.id),
    name: text('name').notNull(),
    leadPrincipalId: uuid('lead_principal_id').references(() => principals.id),
    ...archivable,
    ...timestamps,
    ...actors,
  },
  (t) => [index('teams_entity_idx').on(t.entityId)],
);
