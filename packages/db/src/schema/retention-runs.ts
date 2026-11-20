import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { entities } from './entities';

/**
 * One row per run of a retention job (docs/05-database.md §7). Written only by the jobs themselves,
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
    /**
     * W2: the company a run of a per-company job covered (the WhatsApp media jobs); null for a job
     * that works across the whole group.
     */
    entityId: smallint('entity_id').references(() => entities.id),
    /**
     * W2: where a sweep that stopped for time left off (the last store key it examined), for the
     * next run to go on after; null when the sweep reached its end.
     */
    resumeKey: text('resume_key'),
  },
  (t) => [
    check('retention_runs_job_check', sql`${t.job} ~ '^[a-z]+(-[a-z]+)*$'`),
    check('retention_runs_rows_affected_check', sql`${t.rowsAffected} >= 0`),
    check('retention_runs_error_length_check', sql`char_length(${t.error}) <= 500`),
    check('retention_runs_resume_key_length_check', sql`char_length(${t.resumeKey}) <= 300`),
    // The latest runs of a job first.
    index('retention_runs_job_started_idx').on(t.job, t.startedAt.desc()),
  ],
);
