import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { agentActions } from './agents';
import { callDispositions } from './crm-config';
import { entities } from './entities';
import { opportunities } from './opportunities';
import { principals } from './principals';
import { providerCalls } from './provider-calls';

/**
 * The Caller Co-pilot's briefs and call summaries on a lead (docs/05-database.md §6.9,
 * docs/03-roadmap-appendix/phase2.md §7.3): a child of the lead, read with it, so whoever reads
 * the lead reads its notes. Written only by `agent:copilot` through `agents.note.record`
 * (`agents.note.write`), and append-only: no request changes or removes a note; the stale-lead
 * anonymisation removes the notes of the leads it anonymises.
 *
 * `body` is the brief or summary the output filter passed, masked again before it is stored.
 * A summary (`call_summary`) names the provider call it summarises, once per call, the
 * qualification facts it heard (`fields_json`) and the outcome it would pre-select in the call
 * log (`suggested_disposition_id`); the outcome is never logged by the agent. A brief names none
 * of them. `agent_action_id` is the suggestion filed with the note, when there is one.
 */
export const copilotNotes = pgTable(
  'copilot_notes',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    opportunityId: uuid('opportunity_id').notNull(),
    providerCallId: uuid('provider_call_id').references(() => providerCalls.id),
    kind: text('kind').notNull(),
    body: text('body').notNull(),
    fieldsJson: jsonb('fields_json').notNull().default({}),
    suggestedDispositionId: uuid('suggested_disposition_id').references(() => callDispositions.id),
    agentActionId: uuid('agent_action_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
  },
  (t) => [
    foreignKey({
      name: 'copilot_notes_opportunity_fk',
      columns: [t.opportunityId, t.entityId],
      foreignColumns: [opportunities.id, opportunities.entityId],
    }),
    foreignKey({
      name: 'copilot_notes_agent_action_fk',
      columns: [t.agentActionId, t.entityId],
      foreignColumns: [agentActions.id, agentActions.entityId],
    }),
    check('copilot_notes_kind_check', sql`${t.kind} in ('brief', 'call_summary')`),
    check('copilot_notes_body_check', sql`char_length(${t.body}) between 1 and 600`),
    // A summary is of one call and may carry an outcome; a brief is of no call and carries
    // neither an outcome nor facts. Not-equal tests only, so the enum pairing does not read them
    // as value lists.
    check(
      'copilot_notes_call_check',
      sql`(${t.kind} <> 'call_summary') = (${t.providerCallId} is null)`,
    ),
    check(
      'copilot_notes_brief_check',
      sql`${t.kind} <> 'brief' or (${t.suggestedDispositionId} is null and ${t.fieldsJson} = '{}'::jsonb)`,
    ),
    check(
      'copilot_notes_fields_check',
      sql`jsonb_typeof(${t.fieldsJson}) = 'object' and pg_column_size(${t.fieldsJson}) <= 1000`,
    ),
    // One summary per call: a repeated delivery of the call's end records nothing twice.
    uniqueIndex('copilot_notes_call_unique')
      .on(t.providerCallId)
      .where(sql`${t.providerCallId} is not null`),
    // The panel: a lead's notes, newest first; the brief limit reads the lead's newest brief.
    index('copilot_notes_opportunity_idx').on(
      t.opportunityId,
      t.kind,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('copilot_notes_agent_action_idx')
      .on(t.agentActionId)
      .where(sql`${t.agentActionId} is not null`),
    // The shadow report sets suggested outcomes beside the logged ones, per company and time.
    index('copilot_notes_entity_created_idx')
      .on(t.entityId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.kind} = 'call_summary'`),
    index('copilot_notes_disposition_idx')
      .on(t.suggestedDispositionId)
      .where(sql`${t.suggestedDispositionId} is not null`),
  ],
);
