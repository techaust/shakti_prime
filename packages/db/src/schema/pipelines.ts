import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { actors, archivable, timestamps } from './columns';
import { entities } from './entities';

/** Configurable pipelines, one per segment (docs/01-blueprint.md §8.1). `entity_id` null means shared. */
export const pipelines = pgTable(
  'pipelines',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id').references(() => entities.id),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    segment: text('segment').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    /** Hours an assigned lead stays with its new owner before others may take it (design §7.2). */
    lockHours: smallint('lock_hours').notNull().default(48),
    /** Minutes a new lead may wait for its first call; null sets no limit (design §6.6). */
    firstContactSlaMinutes: integer('first_contact_sla_minutes'),
    ...archivable,
    ...timestamps,
    ...actors,
  },
  (t) => [
    check(
      'pipelines_segment_check',
      sql`${t.segment} in ('farmer_pumps', 'residential_rooftop', 'commercial_epc', 'dealer_wholesale')`,
    ),
    check('pipelines_lock_hours_check', sql`${t.lockHours} between 1 and 720`),
    check(
      'pipelines_first_contact_sla_check',
      sql`${t.firstContactSlaMinutes} is null or ${t.firstContactSlaMinutes} between 1 and 10080`,
    ),
  ],
);

/** Stages with exit rules that Executives edit without code changes (CRM-05). */
export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    id: uuid('id').primaryKey(),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipelines.id),
    entityId: smallint('entity_id').references(() => entities.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    kind: text('kind').notNull().default('open'),
    stageExitRulesJson: jsonb('stage_exit_rules_json').notNull().default({}),
    ...archivable,
    ...timestamps,
    ...actors,
  },
  (t) => [
    unique('pipeline_stages_pipeline_key_unique').on(t.pipelineId, t.key),
    unique('pipeline_stages_pipeline_position_unique').on(t.pipelineId, t.position),
    // The target of the opportunities (stage_id, pipeline_id) key (AUDIT L2).
    unique('pipeline_stages_id_pipeline_unique').on(t.id, t.pipelineId),
    check('pipeline_stages_kind_check', sql`${t.kind} in ('open', 'won', 'lost')`),
  ],
);
