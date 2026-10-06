import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { actors, actorsRequired, timestamps } from './columns';
import { entities } from './entities';
import { principals } from './principals';
import { teams } from './teams';

/**
 * Autonomy, daily spend caps and kill switches of the agents (docs/DATABASE.md §6.9, BLUEPRINT
 * §9.3). A row names an agent or every agent (`agent` null), an action type or every one
 * (`action_type` null), and a company or the group (`entity_id` null). A switch that is off at
 * any level stops the agent; autonomy and the cap come from the most specific row that sets them.
 * Only an agent's row may set autonomy or a cap, and a cap only on its row for every action type.
 * One row per agent, action type and company, nulls not distinct (written in the migration,
 * because drizzle-kit cannot express it).
 */
export const agentConfigs = pgTable(
  'agent_configs',
  {
    id: uuid('id').primaryKey(),
    agent: text('agent'),
    actionType: text('action_type'),
    entityId: smallint('entity_id').references(() => entities.id),
    autonomy: text('autonomy'),
    dailySpendCapPaise: bigint('daily_spend_cap_paise', { mode: 'number' }),
    enabled: boolean('enabled').notNull().default(true),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    check('agent_configs_agent_check', sql`${t.agent} like 'agent:%'`),
    check(
      'agent_configs_autonomy_check',
      sql`${t.autonomy} in ('suggest', 'needs_approval', 'automatic')`,
    ),
    check('agent_configs_cap_check', sql`${t.dailySpendCapPaise} >= 0`),
    check(
      'agent_configs_every_agent_check',
      sql`${t.agent} is not null or (${t.actionType} is null and ${t.autonomy} is null and ${t.dailySpendCapPaise} is null)`,
    ),
    check(
      'agent_configs_cap_per_agent_check',
      sql`${t.actionType} is null or ${t.dailySpendCapPaise} is null`,
    ),
  ],
);

/**
 * One row per agent invocation (docs/DATABASE.md §6.9): which agent ran, for what, on which model,
 * the tokens and cost in whole paise, how it ended and how long it took. Never the prompt or the
 * answer. Written once by the agent's own principal; read with the agent controls.
 */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    agent: text('agent').notNull(),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => principals.id),
    purpose: text('purpose').notNull(),
    actionType: text('action_type').notNull(),
    model: text('model'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    costPaise: bigint('cost_paise', { mode: 'number' }).notNull().default(0),
    outcome: text('outcome').notNull(),
    durationMs: integer('duration_ms').notNull().default(0),
    requestId: text('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('agent_runs_id_entity_unique').on(t.id, t.entityId),
    check('agent_runs_agent_check', sql`${t.agent} like 'agent:%'`),
    check(
      'agent_runs_outcome_check',
      sql`${t.outcome} in ('proposed', 'acted', 'nothing_to_do', 'switched_off', 'cap_reached', 'unavailable', 'failed')`,
    ),
    check(
      'agent_runs_counts_check',
      sql`${t.tokensIn} >= 0 and ${t.tokensOut} >= 0 and ${t.costPaise} >= 0 and ${t.durationMs} >= 0`,
    ),
    check('agent_runs_request_id_check', sql`char_length(${t.requestId}) between 1 and 128`),
    index('agent_runs_agent_day_idx').on(t.agent, t.entityId, t.createdAt),
    index('agent_runs_entity_created_idx').on(t.entityId, t.createdAt),
  ],
);

/**
 * An action an agent proposed or took (docs/DATABASE.md §5, §6.9): the command it runs
 * (`action_type`) and that command's input. Append-only except the decision columns, which only
 * the inbox commands change, once, from `proposed`.
 */
export const agentActions = pgTable(
  'agent_actions',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    runId: uuid('run_id').notNull(),
    agent: text('agent').notNull(),
    actionType: text('action_type').notNull(),
    inputJson: jsonb('input_json').notNull(),
    autonomy: text('autonomy').notNull(),
    state: text('state').notNull(),
    edited: boolean('edited').notNull().default(false),
    decidedInputJson: jsonb('decided_input_json'),
    decidedBy: uuid('decided_by').references(() => principals.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
  },
  (t) => [
    foreignKey({
      name: 'agent_actions_run_fk',
      columns: [t.runId, t.entityId],
      foreignColumns: [agentRuns.id, agentRuns.entityId],
    }),
    unique('agent_actions_id_entity_unique').on(t.id, t.entityId),
    check('agent_actions_agent_check', sql`${t.agent} like 'agent:%'`),
    check(
      'agent_actions_autonomy_check',
      sql`${t.autonomy} in ('suggest', 'needs_approval', 'automatic')`,
    ),
    check(
      'agent_actions_state_check',
      sql`${t.state} in ('proposed', 'executed', 'approved', 'rejected', 'dismissed')`,
    ),
    check(
      'agent_actions_decided_check',
      sql`(${t.decidedAt} is null and ${t.decidedBy} is null) = (${t.state} <> 'approved' and ${t.state} <> 'rejected' and ${t.state} <> 'dismissed')`,
    ),
    // Dismissed is a Suggest action's only decision; approved and rejected are never a Suggest's.
    // Not-equal tests only, so the enum pairing does not read them as value lists.
    check(
      'agent_actions_dismissed_check',
      sql`${t.state} <> 'dismissed' or (${t.autonomy} <> 'needs_approval' and ${t.autonomy} <> 'automatic')`,
    ),
    check(
      'agent_actions_decided_autonomy_check',
      sql`(${t.state} <> 'approved' and ${t.state} <> 'rejected') or ${t.autonomy} <> 'suggest'`,
    ),
    check(
      'agent_actions_input_size_check',
      sql`pg_column_size(${t.inputJson}) <= 4000 and (${t.decidedInputJson} is null or pg_column_size(${t.decidedInputJson}) <= 4000)`,
    ),
    index('agent_actions_run_idx').on(t.runId, t.entityId),
    // The decisions the promotion rule counts, per company, in its window (agents' defaults).
    index('agent_actions_record_idx')
      .on(t.entityId, t.agent, t.actionType, t.decidedAt)
      .where(sql`${t.autonomy} = 'needs_approval' and ${t.state} in ('approved', 'rejected')`),
  ],
);

/**
 * A person's Agent Inbox (docs/DATABASE.md §6.9): an agent's suggestion to approve, edit or reject,
 * or work routed to someone. A scope root on `agents.inbox.act` with the assignee as its owner; an
 * item for no one is the company's, read at company scope.
 */
export const inboxItems = pgTable(
  'inbox_items',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    kind: text('kind').notNull(),
    assigneeId: uuid('assignee_id').references(() => principals.id),
    teamId: uuid('team_id').references(() => teams.id),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    state: text('state').notNull().default('open'),
    agentActionId: uuid('agent_action_id'),
    // Routed work only (docs/design/phase1.md §8.1): the enquiry's interest and the note it came
    // with, for the colleague the enquiry was passed to.
    segment: text('segment'),
    note: text('note'),
    doneBy: uuid('done_by').references(() => principals.id),
    doneAt: timestamp('done_at', { withTimezone: true }),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    foreignKey({
      name: 'inbox_items_action_fk',
      columns: [t.agentActionId, t.entityId],
      foreignColumns: [agentActions.id, agentActions.entityId],
    }),
    unique('inbox_items_action_unique').on(t.agentActionId),
    check('inbox_items_kind_check', sql`${t.kind} in ('agent_suggestion', 'routed_work')`),
    check('inbox_items_state_check', sql`${t.state} in ('open', 'done')`),
    check(
      'inbox_items_segment_check',
      sql`${t.segment} in ('farmer_pumps', 'residential_rooftop', 'commercial_epc', 'dealer_wholesale')`,
    ),
    check('inbox_items_note_check', sql`char_length(${t.note}) between 1 and 500`),
    check(
      'inbox_items_routed_check',
      sql`${t.kind} <> 'agent_suggestion' or (${t.segment} is null and ${t.note} is null)`,
    ),
    check('inbox_items_subject_type_check', sql`${t.subjectType} in ('opportunity', 'account')`),
    check(
      'inbox_items_suggestion_check',
      sql`(${t.kind} <> 'agent_suggestion') = (${t.agentActionId} is null)`,
    ),
    check(
      'inbox_items_done_check',
      sql`(${t.state} <> 'done') = (${t.doneAt} is null and ${t.doneBy} is null)`,
    ),
    index('inbox_items_assignee_open_idx').on(t.assigneeId, t.state, t.createdAt, t.id),
    index('inbox_items_team_open_idx').on(t.teamId, t.state, t.createdAt, t.id),
    index('inbox_items_entity_open_idx').on(t.entityId, t.state, t.createdAt, t.id),
  ],
);

/**
 * A scored run of an eval set for one agent's prompt version (docs/DATABASE.md §6.9, BLUEPRINT
 * §9.3): a prompt or model change ships only with a passing run. Of no company; written only by
 * the eval runner as the table owner, read with `agents.autonomy.write` for every company.
 */
export const agentEvals = pgTable(
  'agent_evals',
  {
    id: uuid('id').primaryKey(),
    agent: text('agent').notNull(),
    promptVersion: text('prompt_version').notNull(),
    model: text('model').notNull(),
    evalSet: text('eval_set').notNull(),
    casesTotal: integer('cases_total').notNull(),
    casesPassed: integer('cases_passed').notNull(),
    score: numeric('score', { precision: 5, scale: 2 }).notNull(),
    ranAt: timestamp('ran_at', { withTimezone: true }).notNull(),
    ...timestamps,
    ...actors,
  },
  (t) => [
    check('agent_evals_agent_check', sql`${t.agent} like 'agent:%'`),
    check(
      'agent_evals_cases_check',
      sql`${t.casesTotal} > 0 and ${t.casesPassed} between 0 and ${t.casesTotal}`,
    ),
    check('agent_evals_score_check', sql`${t.score} between 0 and 100`),
    index('agent_evals_agent_ran_idx').on(t.agent, t.ranAt),
  ],
);
