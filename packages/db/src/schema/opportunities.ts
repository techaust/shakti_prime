import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { accounts, customerSites } from './accounts';
import { actorsRequired, archivable, timestamps } from './columns';
import { entities } from './entities';
import { leadSources } from './lead-sources';
import { pipelines, pipelineStages } from './pipelines';
import { principals } from './principals';
import { teams } from './teams';

/**
 * A sale on a pipeline for an account and site (docs/BLUEPRINT.md §6.2). Scope root for
 * `crm.lead.*`. `state` is written only by the opportunity state machine (Phase 1).
 */
export const opportunities = pgTable(
  'opportunities',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    siteId: uuid('site_id').references(() => customerSites.id),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => pipelineStages.id),
    ownerId: uuid('owner_id').references(() => principals.id),
    teamId: uuid('team_id').references(() => teams.id),
    score: integer('score').notNull().default(0),
    sourceId: uuid('source_id').references(() => leadSources.id),
    campaignJson: jsonb('campaign_json').notNull().default({}),
    state: text('state').notNull().default('open'),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    ...archivable,
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('opportunities_state_check', sql`${t.state} in ('open', 'won', 'lost')`),
    check('opportunities_score_check', sql`${t.score} between 0 and 100`),
    index('opportunities_queue_idx').on(t.entityId, t.stageId, t.ownerId, t.updatedAt.desc()),
    index('opportunities_account_idx').on(t.accountId),
    index('opportunities_entity_owner_idx').on(t.entityId, t.ownerId),
    index('opportunities_entity_team_idx').on(t.entityId, t.teamId),
    index('opportunities_keyset_idx').on(t.updatedAt, t.id),
    index('opportunities_pipeline_stage_idx').on(t.pipelineId, t.stageId),
    index('opportunities_site_idx').on(t.siteId),
    index('opportunities_source_idx').on(t.sourceId),
    foreignKey({
      name: 'opportunities_account_entity_fk',
      columns: [t.accountId, t.entityId],
      foreignColumns: [accounts.id, accounts.entityId],
    }),
    foreignKey({
      name: 'opportunities_site_entity_fk',
      columns: [t.siteId, t.entityId],
      foreignColumns: [customerSites.id, customerSites.entityId],
    }),
  ],
);
