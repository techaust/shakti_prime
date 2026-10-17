import { afterEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  captureCheckIn: vi.fn(),
  flush: vi.fn(() => Promise.resolve(true)),
  loaded: 0,
}));
vi.mock('@sentry/nextjs', () => {
  sentry.loaded += 1;
  return { captureCheckIn: sentry.captureCheckIn, flush: sentry.flush };
});

const { monitored, MONITORED_JOBS, sendCheckIn } = await import('./check-ins');
const { checkInMarginMinutes, JOB_SCHEDULES } = await import('../workers/schedules');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('sendCheckIn (audit 2026-10, OPS-4)', () => {
  it('sends nothing, and loads no SDK, without a DSN', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    await sendCheckIn('quote-expire', 'ok');
    expect(sentry.loaded).toBe(0);
  });

  it('checks a call in to the monitor named by its schedule, with the schedule, and flushes it', async () => {
    vi.stubEnv('SENTRY_DSN', 'https://publickey@o4501.ingest.us.sentry.io/4502');
    vi.stubEnv('BOS_ENVIRONMENT', 'production');
    await sendCheckIn('outbox-publish', 'error');
    expect(sentry.captureCheckIn).toHaveBeenCalledWith(
      { monitorSlug: 'outbox-publish', status: 'error' },
      {
        schedule: { type: 'crontab', value: JOB_SCHEDULES['outbox-publish'] },
        checkinMargin: 3,
        maxRuntime: 5,
        timezone: 'Etc/UTC',
      },
    );
    expect(sentry.flush).toHaveBeenCalledWith(2_000);
  });

  it("keeps to the free plan's one cron monitor: production's outbox publisher", async () => {
    expect(MONITORED_JOBS).toEqual({ production: ['outbox-publish'] });
    vi.stubEnv('SENTRY_DSN', 'https://publickey@o4501.ingest.us.sentry.io/4502');
    for (const environment of ['dev', 'staging', 'production', 'constructor', '']) {
      vi.stubEnv('BOS_ENVIRONMENT', environment);
      for (const job of Object.keys(JOB_SCHEDULES) as (keyof typeof JOB_SCHEDULES)[]) {
        expect(monitored(job)).toBe(environment === 'production' && job === 'outbox-publish');
      }
    }
    vi.stubEnv('BOS_ENVIRONMENT', 'staging');
    await sendCheckIn('outbox-publish', 'ok');
    vi.stubEnv('BOS_ENVIRONMENT', 'production');
    await sendCheckIn('quote-expire', 'ok');
    expect(sentry.captureCheckIn).not.toHaveBeenCalled();
  });

  it('gives each schedule a margin fit for how often it runs', () => {
    expect(checkInMarginMinutes('outbox-publish')).toBe(3);
    expect(checkInMarginMinutes('notification-scan')).toBe(10);
    expect(checkInMarginMinutes('files-sweep')).toBe(20);
    expect(checkInMarginMinutes('jobs-check')).toBe(20);
    expect(checkInMarginMinutes('lead-rescore')).toBe(60);
    expect(checkInMarginMinutes('lead-anonymise')).toBe(60);
    expect(Object.keys(JOB_SCHEDULES)).toHaveLength(8);
  });
});
