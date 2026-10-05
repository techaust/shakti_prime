import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { customerSites } from './accounts';
import { entities } from './entities';
import { items } from './items';
import { opportunities } from './opportunities';
import { principals } from './principals';

/**
 * A pump or rooftop sizing of a lead (docs/design/phase1.md §6.7, docs/DATABASE.md §6.2), a child
 * of `opportunities`: read with the lead, written with the lead's write scope. Append-only: a new
 * sizing is a new row and the newest of its kind is the one a quote uses. The server computes
 * `result_json`, `in_bounds` and `reasons_json` from `inputs_json` with the engine named in
 * `engine_version`; a caller never supplies them.
 */
export const sizings = pgTable(
  'sizings',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    opportunityId: uuid('opportunity_id').notNull(),
    /** The lead's site when the sizing was recorded. */
    siteId: uuid('site_id').references(() => customerSites.id),
    kind: text('kind').notNull(),
    /** The catalogue pump the duty point was checked against (pump sizings only). */
    itemId: uuid('item_id').references(() => items.id),
    inputsJson: jsonb('inputs_json').notNull(),
    resultJson: jsonb('result_json').notNull(),
    inBounds: boolean('in_bounds').notNull(),
    reasonsJson: jsonb('reasons_json').notNull().default([]),
    engineVersion: text('engine_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
  },
  (t) => [
    check('sizings_kind_check', sql`${t.kind} in ('pump', 'rooftop')`),
    check('sizings_item_kind_check', sql`${t.itemId} is null or ${t.kind} = 'pump'`),
    // In bounds exactly when no reason is recorded.
    check(
      'sizings_reasons_check',
      sql`jsonb_typeof(${t.reasonsJson}) = 'array' and ${t.inBounds} = (jsonb_array_length(${t.reasonsJson}) = 0)`,
    ),
    check('sizings_engine_version_check', sql`length(${t.engineVersion}) between 1 and 20`),
    // The sizing belongs to its lead's company.
    foreignKey({
      name: 'sizings_opportunity_entity_fk',
      columns: [t.opportunityId, t.entityId],
      foreignColumns: [opportunities.id, opportunities.entityId],
    }),
    // The newest sizing of a lead of one kind, the one a quote uses, is the first entry of this
    // index for the lead and kind; the newest of either kind reads the lead's few rows and sorts.
    index('sizings_opportunity_kind_latest_idx').on(
      t.opportunityId,
      t.kind,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  ],
);
