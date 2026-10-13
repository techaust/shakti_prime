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

const { sendCheckIn } = await import('./check-ins');
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
    await sendCheckIn('quote-expire', 'error');
    expect(sentry.captureCheckIn).toHaveBeenCalledWith(
      { monitorSlug: 'quote-expire', status: 'error' },
      {
        schedule: { type: 'crontab', value: '35 18 * * *' },
        checkinMargin: 60,
        maxRuntime: 5,
        timezone: 'Etc/UTC',
      },
    );
    expect(sentry.flush).toHaveBeenCalledWith(2_000);
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
