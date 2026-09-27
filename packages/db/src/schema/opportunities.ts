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
 * `crm.lead.*`. `state` is written only by the opportunity state machine (Phase 1). The trigger
 * `app.ensure_account_entity()` refuses an entity that has no `account_entities` row (ADR 0008).
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
    // The stage belongs to the opportunity's own pipeline (AUDIT L2).
    foreignKey({
      name: 'opportunities_stage_pipeline_fk',
      columns: [t.stageId, t.pipelineId],
      foreignColumns: [pipelineStages.id, pipelineStages.pipelineId],
    }),
    check('opportunities_score_check', sql`${t.score} between 0 and 100`),
    index('opportunities_queue_idx').on(t.entityId, t.stageId, t.ownerId, t.updatedAt.desc()),
    index('opportunities_account_idx').on(t.accountId),
    // A caller with own or team scope pages their leads straight off these (AUDIT M33).
    // `nullsFirst` matches the list's plain `order by … desc`, so the index serves the order.
    index('opportunities_entity_owner_idx').on(
      t.entityId,
      t.ownerId,
      t.updatedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('opportunities_entity_team_idx').on(
      t.entityId,
      t.teamId,
      t.updatedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('opportunities_keyset_idx').on(t.updatedAt, t.id),
    index('opportunities_pipeline_stage_idx').on(t.pipelineId, t.stageId),
    index('opportunities_site_idx').on(t.siteId),
    index('opportunities_source_idx').on(t.sourceId),
  ],
);
