import { asMigrator, closeDb } from '@shakti/db/testing';
import { memoryKeyValue } from '@shakti/domain';
import { afterAll, describe, expect, it } from 'vitest';
import { memoryAlertSink } from '../src/observability/alerts';
import { runJobsCheck } from '../src/workers/jobs-check';

afterAll(async () => {
  await closeDb();
});

describe('the hourly check of the scheduled jobs (audit 2026-10, DATA-3)', () => {
  it('reads every job as the worker principal and tells each problem once per job and run', async () => {
    const keyValue = memoryKeyValue();
    const alerts = memoryAlertSink();
    // A year from now every job that ever ran is late. The migrations run the outbox purge once
    // and record it, so that one at least has a problem to tell (review L8).
    const now = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const first = await runJobsCheck({ requestId: 'jobs-check-1', keyValue, alerts, now });
    expect(first.jobs).toBe(5);
    expect(first.problems).toBeGreaterThan(0);
    expect(first.alerted).toBe(first.problems);
    expect(alerts.alerts).toContainEqual({
      name: 'job.problem',
      fields: { job: 'outbox-events-purge', problem: 'late' },
    });
    for (const alert of alerts.alerts) {
      expect(alert.name).toBe('job.problem');
      expect(Object.keys(alert.fields).sort()).toEqual(['job', 'problem']);
    }
    const again = await runJobsCheck({ requestId: 'jobs-check-2', keyValue, alerts, now });
    expect(again).toEqual({ ...first, alerted: 0 });
    expect(alerts.alerts).toHaveLength(first.alerted);
  });

  it('tells of a run that has gone on past its time limit as stuck (review M2)', async () => {
    // pg_cron's record of a run of the idempotency purge that started an hour ago and never ended.
    const [run] = await asMigrator(
      (m) => m<{ runid: string }[]>`
        insert into cron.job_run_details (jobid, database, username, command, status, start_time)
        select j.jobid, j.database, j.username, j.command, 'running', now() - interval '1 hour'
          from cron.job j where j.jobname = 'idempotency-keys-purge'
        returning runid::text`,
    );
    try {
      const alerts = memoryAlertSink();
      const answer = await runJobsCheck({
        requestId: 'jobs-check-stuck',
        keyValue: memoryKeyValue(),
        alerts,
      });
      expect(answer.problems).toBeGreaterThan(0);
      expect(alerts.alerts).toContainEqual({
        name: 'job.problem',
        fields: { job: 'idempotency-keys-purge', problem: 'stuck' },
      });
    } finally {
      await asMigrator(
        (m) => m`delete from cron.job_run_details where runid = ${run?.runid ?? '0'}::bigint`,
      );
    }
  });

  it('finds nothing late on a database whose jobs have not yet been due', async () => {
    const alerts = memoryAlertSink();
    const answer = await runJobsCheck({
      requestId: 'jobs-check-3',
      keyValue: memoryKeyValue(),
      alerts,
      now: new Date(0),
    });
    // At the epoch no run is in the past, so nothing is late; a failure would still be told.
    expect(answer.jobs).toBe(5);
    expect(alerts.alerts.filter((a) => a.fields.problem === 'late')).toEqual([]);
  });
});
