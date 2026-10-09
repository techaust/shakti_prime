import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { entities } from './entities';
import { principals } from './principals';
import { teams } from './teams';

/**
 * A target set for a caller or a team (docs/03-roadmap-appendix/phase1.md §9, PRD TEL-06, RPT-01):
 * a number of one metric (calls logged, leads qualified, orders confirmed, kW sold) for a day, a
 * week (Monday to Sunday) or a month in IST. Append-only: setting a target adds a row, and the row
 * with the newest `set_at` among those of the same subject, metric and period whose `starts_on`
 * is the latest not after a period's first day is the one that counts for that period, so a
 * target holds for every later period of its kind until a newer one is set, and the earlier rows
 * stay as the history. A value of 0 means no target. `subject_id` is a person (`caller`) or a
 * team (`team`); `team_id` is the team the subject belonged to when the target was set (the team
 * itself for a team target), which is how a team lead reads the targets of their callers. The
 * progress against a target is worked out from the calls, stage moves and orders and never
 * stored. No target has a default: the table starts empty.
 */
export const targets = pgTable(
  'targets',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    scope: text('scope').notNull(),
    subjectId: uuid('subject_id').notNull(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    metric: text('metric').notNull(),
    period: text('period').notNull(),
    startsOn: date('starts_on', { mode: 'string' }).notNull(),
    value: numeric('value', { precision: 12, scale: 2 }).notNull(),
    setBy: uuid('set_by')
      .notNull()
      .references(() => principals.id),
    setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('targets_scope_check', sql`${t.scope} in ('caller', 'team')`),
    check('targets_metric_check', sql`${t.metric} in ('calls', 'qualified', 'orders', 'kw')`),
    check('targets_period_check', sql`${t.period} in ('day', 'week', 'month')`),
    check('targets_value_check', sql`${t.value} >= 0`),
    // A period starts on its first day: any day, a Monday, or the 1st.
    check(
      'targets_starts_on_check',
      sql`(${t.period} = 'day')
        or (${t.period} = 'week' and extract(isodow from ${t.startsOn}) = 1)
        or (${t.period} = 'month' and extract(day from ${t.startsOn}) = 1)`,
    ),
    // A team target names its own team.
    check('targets_team_subject_check', sql`${t.scope} <> 'team' or ${t.subjectId} = ${t.teamId}`),
    // The target in force for a subject's metric and period is the first entry for it.
    index('targets_subject_idx').on(
      t.entityId,
      t.scope,
      t.subjectId,
      t.metric,
      t.period,
      t.startsOn.desc(),
      t.setAt.desc(),
      t.id.desc(),
    ),
    // A team lead reads the targets of the team's callers; the history reads newest first.
    index('targets_team_idx').on(t.teamId, t.setAt.desc()),
    index('targets_set_by_idx').on(t.setBy),
  ],
);
