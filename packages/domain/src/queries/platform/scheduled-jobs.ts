import {
  DATABASE_JOBS,
  DatabaseJobSchema,
  ScheduledJobHealth,
  type DatabaseJob,
  type ScheduledJobHealth as JobHealth,
  type ScheduledJobState,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';

/** One row of `app.scheduled_jobs()`: a job's schedule, its last pg_cron run and its last record. */
export interface ScheduledJobRow {
  job: string;
  schedule: string;
  active: boolean;
  runStatus: string | null;
  runStartedAt: Date | null;
  runFinishedAt: Date | null;
  runMessage: string | null;
  recordedStartedAt: Date | null;
  recordedFinishedAt: Date | null;
  recordedError: string | null;
  historySince: Date | null;
}

/** A job's health with the error behind a failure, for the check's log line; never for a screen. */
export interface ScheduledJobReport {
  health: JobHealth;
  error: string | null;
}

const HOUR_MS = 60 * 60 * 1000;

/** pg_cron's states of a run that has not finished. */
const UNFINISHED: ReadonlySet<string> = new Set(['starting', 'running', 'sending', 'connecting']);

/**
 * How often a five-field cron schedule runs, in hours, as the check needs it: monthly when it names
 * a day of the month (31 days, the longest month), weekly when it names a day of the week, hourly
 * when it names no hour, and otherwise daily.
 */
export function scheduleEveryHours(schedule: string): number {
  const [, hour = '*', dayOfMonth = '*', , dayOfWeek = '*'] = schedule.trim().split(/\s+/);
  if (dayOfMonth !== '*') return 31 * 24;
  if (dayOfWeek !== '*') return 7 * 24;
  if (hour === '*') return 1;
  return 24;
}

/** The margin past its period before a job counts as late: six hours, or one period when shorter. */
function graceHours(everyHours: number): number {
  return Math.min(6, everyHours);
}

const latest = (a: Date | null, b: Date | null): Date | null =>
  a === null ? b : b === null ? a : a > b ? a : b;

/**
 * Where one job stands (`ScheduledJobState`), from its row, or `missing` when the database does not
 * schedule it. A run the job recorded as failed in `retention_runs` counts as failed even when
 * pg_cron recorded it as succeeded, as `activities-partitions` does with a month it could not make,
 * unless pg_cron has recorded a newer run since. A job that never ran is late once pg_cron has kept
 * runs for longer than its period and margin, since its first run was due by then.
 */
export function scheduledJobHealth(
  job: DatabaseJob,
  row: ScheduledJobRow | undefined,
  now: Date,
): ScheduledJobReport {
  if (row === undefined) {
    return {
      health: { job, state: 'missing', lastRunAt: null, lastFinishedAt: null, everyHours: 24 },
      error: null,
    };
  }
  const everyHours = scheduleEveryHours(row.schedule);
  const lastRunAt = latest(row.runStartedAt, row.recordedStartedAt);
  const lastFinishedAt = latest(row.runFinishedAt, row.recordedFinishedAt);
  const recordedFailed =
    row.recordedError !== null &&
    row.recordedStartedAt !== null &&
    (row.runStartedAt === null || row.recordedStartedAt >= row.runStartedAt);
  const dueBy = (everyHours + graceHours(everyHours)) * HOUR_MS;
  const since = lastRunAt ?? row.historySince;
  const overdue = since !== null && now.getTime() - since.getTime() > dueBy;

  let state: ScheduledJobState;
  let error: string | null = null;
  if (!row.active) state = 'paused';
  else if (row.runStatus === 'failed' || recordedFailed) {
    state = 'failed';
    error = recordedFailed ? row.recordedError : row.runMessage;
  } else if (row.runStatus !== null && UNFINISHED.has(row.runStatus)) state = 'running';
  else if (overdue) state = 'late';
  else if (lastRunAt === null) state = 'waiting';
  else state = 'ok';

  return {
    health: ScheduledJobHealth.parse({
      job,
      state,
      lastRunAt: lastRunAt?.toISOString() ?? null,
      lastFinishedAt: lastFinishedAt?.toISOString() ?? null,
      everyHours,
    }),
    error,
  };
}

/** A timestamp as the driver answers it through `execute()`: a date or its text, or null. */
const at = (value: unknown): Date | null =>
  value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * The database's scheduled jobs (audit 2026-10, DATA-3), each expected job in turn, through
 * `app.scheduled_jobs()`, which needs `admin.integrations.write:all` (Integration Health) or
 * `integrations.jobs.check:all` (the hourly check). Jobs the database runs that are not ours (a
 * hosting provider's own) are left out.
 */
export async function readScheduledJobs(
  ctx: Pick<RequestContext, 'tx'>,
  now: Date = new Date(),
): Promise<ScheduledJobReport[]> {
  const rows = (await ctx.tx.execute(sql`
    select job, schedule, active, run_status, run_started_at, run_finished_at, run_message,
           recorded_started_at, recorded_finished_at, recorded_error, history_since
      from app.scheduled_jobs()`)) as unknown as Record<string, unknown>[];
  const byJob = new Map<DatabaseJob, ScheduledJobRow>();
  for (const r of rows) {
    const job = DatabaseJobSchema.safeParse(r.job);
    if (!job.success) continue;
    byJob.set(job.data, {
      job: job.data,
      schedule: text(r.schedule) ?? '',
      active: r.active === true,
      runStatus: text(r.run_status),
      runStartedAt: at(r.run_started_at),
      runFinishedAt: at(r.run_finished_at),
      runMessage: text(r.run_message),
      recordedStartedAt: at(r.recorded_started_at),
      recordedFinishedAt: at(r.recorded_finished_at),
      recordedError: text(r.recorded_error),
      historySince: at(r.history_since),
    });
  }
  return DATABASE_JOBS.map((job) => scheduledJobHealth(job, byJob.get(job), now));
}
