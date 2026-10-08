import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorsRequired, timestamps } from './columns';
import { entities } from './entities';
import { opportunities } from './opportunities';
import { principals } from './principals';
import { teams } from './teams';

/**
 * A callback, follow-up, nurture or review on a lead, due at a time, for one person
 * (docs/05-database.md §6.2). A scope root on `crm.lead.*` with the assignee as its owner; the lead
 * must be readable too. `state` and `done_at` are written only by the task commands through the
 * task machine. `account_id` is the lead's own customer (the composite key), so Account 360 reads
 * a customer's tasks without a join.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    opportunityId: uuid('opportunity_id').notNull(),
    accountId: uuid('account_id').notNull(),
    assigneeId: uuid('assignee_id')
      .notNull()
      .references(() => principals.id),
    teamId: uuid('team_id').references(() => teams.id),
    kind: text('kind').notNull(),
    title: text('title'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    state: text('state').notNull().default('open'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    // A customer merge moves a lead to the kept customer; its tasks follow it (`ON UPDATE CASCADE`).
    foreignKey({
      name: 'tasks_opportunity_fk',
      columns: [t.opportunityId, t.entityId, t.accountId],
      foreignColumns: [opportunities.id, opportunities.entityId, opportunities.accountId],
    }).onUpdate('cascade'),
    check('tasks_kind_check', sql`${t.kind} in ('callback', 'follow_up', 'nurture', 'review')`),
    check('tasks_state_check', sql`${t.state} in ('open', 'done', 'cancelled')`),
    check('tasks_done_at_check', sql`(${t.state} <> 'done') = (${t.doneAt} is null)`),
    check('tasks_title_length_check', sql`char_length(${t.title}) between 1 and 80`),
    index('tasks_assignee_state_due_idx').on(t.assigneeId, t.state, t.dueAt),
    index('tasks_opportunity_idx').on(t.opportunityId, t.entityId, t.accountId),
    index('tasks_account_state_due_idx').on(t.accountId, t.state, t.dueAt),
    index('tasks_team_idx').on(t.teamId),
    // The notification scan: a company's open calls by the time they fall due.
    index('tasks_open_calls_due_idx')
      .on(t.entityId, t.dueAt)
      .where(sql`${t.state} = 'open' and ${t.kind} in ('callback', 'nurture')`),
  ],
);
