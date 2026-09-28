import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * One row per run of a retention job (docs/DATABASE.md §7). Written only by the jobs themselves,
 * which pg_cron runs as the table owner; read with `audit.read:all` (migration 0054). It belongs
 * to no company: a job works across the whole group.
 */
export const retentionRuns = pgTable(
  'retention_runs',
  {
    id: uuid('id').primaryKey(),
    // The pg_cron job name, for example `outbox-events-purge`.
    job: text('job').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    rowsAffected: integer('rows_affected'),
    error: text('error'),
  },
  (t) => [
    check('retention_runs_job_check', sql`${t.job} ~ '^[a-z]+(-[a-z]+)*$'`),
    check('retention_runs_rows_affected_check', sql`${t.rowsAffected} >= 0`),
    check('retention_runs_error_length_check', sql`char_length(${t.error}) <= 500`),
    // The latest runs of a job first.
    index('retention_runs_job_started_idx').on(t.job, t.startedAt.desc()),
  ],
);
