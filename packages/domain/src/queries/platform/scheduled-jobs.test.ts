import type { DatabaseJob } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { scheduledJobHealth, scheduleEveryHours, type ScheduledJobRow } from './scheduled-jobs';

const NOW = new Date('2026-10-13T06:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

function row(overrides: Partial<ScheduledJobRow> = {}): ScheduledJobRow {
  return {
    job: 'outbox-events-purge',
    schedule: '45 2 * * *',
    active: true,
    runStatus: 'succeeded',
    runStartedAt: hoursAgo(3),
    runFinishedAt: hoursAgo(3),
    runMessage: '1 row',
    recordedStartedAt: hoursAgo(3),
    recordedFinishedAt: hoursAgo(3),
    recordedError: null,
    historySince: hoursAgo(24 * 90),
    ...overrides,
  };
}

const state = (r: ScheduledJobRow | undefined, job: DatabaseJob = 'outbox-events-purge') =>
  scheduledJobHealth(job, r, NOW).health.state;

describe('scheduleEveryHours', () => {
  it('reads how often a five-field schedule runs', () => {
    expect(scheduleEveryHours('45 2 * * *')).toBe(24);
    expect(scheduleEveryHours('5 3 25 * *')).toBe(31 * 24);
    expect(scheduleEveryHours('30 3 1 * *')).toBe(31 * 24);
    expect(scheduleEveryHours('0 4 * * 1')).toBe(7 * 24);
    expect(scheduleEveryHours('17 * * * *')).toBe(1);
  });
});

describe('scheduledJobHealth (audit 2026-10, DATA-3)', () => {
  it('is ok after a run that finished without an error, with its times', () => {
    const report = scheduledJobHealth('outbox-events-purge', row(), NOW);
    expect(report).toEqual({
      health: {
        job: 'outbox-events-purge',
        state: 'ok',
        lastRunAt: hoursAgo(3).toISOString(),
        lastFinishedAt: hoursAgo(3).toISOString(),
        everyHours: 24,
      },
      error: null,
    });
  });

  it('is missing when the database does not schedule it, and paused when it is switched off', () => {
    expect(state(undefined)).toBe('missing');
    // A missing job keeps the period it is meant to run on (review L6).
    expect(scheduledJobHealth('activities-partitions', undefined, NOW).health.everyHours).toBe(744);
    expect(scheduledJobHealth('audit-logs-detach', undefined, NOW).health.everyHours).toBe(744);
    expect(scheduledJobHealth('outbox-events-purge', undefined, NOW).health.everyHours).toBe(24);
    expect(state(row({ active: false, runStatus: 'failed' }))).toBe('paused');
  });

  it('is failed when pg_cron recorded the run failed, with its message', () => {
    const report = scheduledJobHealth(
      'outbox-events-purge',
      row({ runStatus: 'failed', runMessage: 'ERROR: outbox-events-purge failed: lock timeout' }),
      NOW,
    );
    expect(report.health.state).toBe('failed');
    expect(report.error).toBe('ERROR: outbox-events-purge failed: lock timeout');
  });

  it('is failed when the job recorded an error that pg_cron recorded as a success', () => {
    const report = scheduledJobHealth(
      'activities-partitions',
      row({
        job: 'activities-partitions',
        schedule: '5 3 25 * *',
        runStartedAt: hoursAgo(24 * 18),
        recordedStartedAt: new Date(hoursAgo(24 * 18).getTime() + 1_000),
        recordedError: '2027-01: updated partition constraint would be violated',
      }),
      NOW,
    );
    expect(report.health.state).toBe('failed');
    expect(report.error).toMatch(/partition constraint/);
  });

  it('is ok again once pg_cron has recorded a newer run than the failed record', () => {
    expect(
      state(
        row({
          recordedStartedAt: hoursAgo(27),
          recordedError: 'earlier failure',
          runStartedAt: hoursAgo(3),
        }),
      ),
    ).toBe('ok');
  });

  it('is running while its last run has not finished, and stuck past its time limit (review M2)', () => {
    const started = (minutes: number) => new Date(NOW.getTime() - minutes * 60 * 1000);
    const unfinished = { runStatus: 'running', runFinishedAt: null, recordedFinishedAt: null };
    expect(state(row({ ...unfinished, runStartedAt: started(10) }))).toBe('running');
    expect(state(row({ ...unfinished, runStartedAt: started(31) }))).toBe('stuck');
    // A partition maker has a two-minute statement limit, so three minutes is its most.
    expect(
      state(row({ ...unfinished, runStartedAt: started(4) }), 'activities-partitions'),
    ).toBe('stuck');
    expect(
      state(row({ ...unfinished, runStartedAt: started(2) }), 'activities-partitions'),
    ).toBe('running');
    // Stuck for days is still stuck, not late: its run never ended.
    expect(state(row({ ...unfinished, runStartedAt: started(5 * 24 * 60) }))).toBe('stuck');
  });

  it('is late once it has not run for its period and six hours, and not before', () => {
    expect(state(row({ runStartedAt: hoursAgo(29), recordedStartedAt: hoursAgo(29) }))).toBe('ok');
    expect(state(row({ runStartedAt: hoursAgo(31), recordedStartedAt: hoursAgo(31) }))).toBe(
      'late',
    );
    const monthly = row({
      schedule: '5 3 25 * *',
      runStartedAt: hoursAgo(24 * 31 + 5),
      recordedStartedAt: null,
    });
    expect(state(monthly, 'activities-partitions')).toBe('ok');
    expect(
      state({ ...monthly, runStartedAt: hoursAgo(24 * 31 + 7) }, 'activities-partitions'),
    ).toBe('late');
  });

  it('is waiting when it never ran and its first run is not yet due, and late once it was', () => {
    const never = row({
      runStatus: null,
      runStartedAt: null,
      runFinishedAt: null,
      runMessage: null,
      recordedStartedAt: null,
      recordedFinishedAt: null,
      historySince: hoursAgo(10),
    });
    expect(state(never)).toBe('waiting');
    expect(state({ ...never, historySince: null })).toBe('waiting');
    expect(state({ ...never, historySince: hoursAgo(31) })).toBe('late');
  });
});
