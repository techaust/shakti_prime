import { afterEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({
  captureMessage: vi.fn(),
  flush: vi.fn<(ms: number) => Promise<boolean>>(),
  loaded: 0,
}));
vi.mock('@sentry/nextjs', () => {
  sentry.loaded += 1;
  return { captureMessage: sentry.captureMessage, flush: sentry.flush };
});

const { sentryAlertSink } = await import('./alerts');
const { logger } = await import('../log');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  sentry.captureMessage.mockReset();
  sentry.flush.mockReset();
});

describe('sentryAlertSink', () => {
  it('only logs the alert, and loads no SDK, without a DSN', async () => {
    const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    vi.stubEnv('SENTRY_DSN', '');
    await sentryAlertSink.report('outbox.dead_lettered', { count: 1, ids: ['a'] });
    expect(log).toHaveBeenCalledWith('error', 'outbox.dead_lettered', { count: 1, ids: ['a'] });
    expect(sentry.loaded).toBe(0);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('sends one message named by the alert, with counts and ids only, when a DSN is set', async () => {
    vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    vi.stubEnv('SENTRY_DSN', 'https://publickey@o4501.ingest.us.sentry.io/4502');
    sentry.flush.mockResolvedValue(true);
    await sentryAlertSink.report('outbox.publisher_failing', { runs: 3, failed: 2 });
    expect(sentry.captureMessage).toHaveBeenCalledWith('outbox.publisher_failing', {
      level: 'error',
      fingerprint: ['outbox.publisher_failing'],
      extra: { runs: 3, failed: 2 },
    });
  });

  it('resolves only once Sentry has flushed the alert, so the function is not frozen with it queued', async () => {
    vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    vi.stubEnv('SENTRY_DSN', 'https://publickey@o4501.ingest.us.sentry.io/4502');
    let flushed: (done: boolean) => void = () => undefined;
    sentry.flush.mockReturnValue(
      new Promise((resolve) => {
        flushed = resolve;
      }),
    );
    let settled = false;
    const reporting = sentryAlertSink.report('outbox.dead_lettered', { count: 1, ids: ['a'] });
    void reporting.then(() => {
      settled = true;
    });
    await vi.waitFor(() => {
      expect(sentry.flush).toHaveBeenCalledWith(2_000);
    });
    expect(settled).toBe(false);
    flushed(true);
    await reporting;
    expect(settled).toBe(true);
  });

  it('groups a job’s alerts by the job, and never rejects when sending fails', async () => {
    const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    vi.stubEnv('SENTRY_DSN', 'https://publickey@o4501.ingest.us.sentry.io/4502');
    sentry.flush.mockRejectedValue(new Error('offline'));
    await sentryAlertSink.report('job.failing', { job: 'quote-expire', runs: 3 });
    expect(sentry.captureMessage).toHaveBeenCalledWith(
      'job.failing',
      expect.objectContaining({ fingerprint: ['job.failing', 'quote-expire'] }),
    );
    expect(log).toHaveBeenCalledWith('warn', 'alert.send_failed', expect.anything());
  });
});
