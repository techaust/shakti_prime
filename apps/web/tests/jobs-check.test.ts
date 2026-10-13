import { closeDb } from '@shakti/db/testing';
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
    // A year from now every job that ever ran is late, so each one has a problem to tell.
    const now = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const first = await runJobsCheck({ requestId: 'jobs-check-1', keyValue, alerts, now });
    expect(first.jobs).toBe(5);
    expect(first.alerted).toBe(first.problems);
    expect(alerts.alerts.every((a) => a.name === 'job.problem')).toBe(true);
    for (const alert of alerts.alerts) {
      expect(Object.keys(alert.fields).sort()).toEqual(['job', 'problem']);
    }
    const again = await runJobsCheck({ requestId: 'jobs-check-2', keyValue, alerts, now });
    expect(again).toEqual({ ...first, alerted: 0 });
    expect(alerts.alerts).toHaveLength(first.alerted);
  });

  it('finds nothing to tell on a database whose jobs have not yet been due', async () => {
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
