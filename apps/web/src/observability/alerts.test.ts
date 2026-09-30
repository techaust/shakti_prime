import { afterEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => ({ captureMessage: vi.fn(), loaded: 0 }));
vi.mock('@sentry/nextjs', () => {
  sentry.loaded += 1;
  return { captureMessage: sentry.captureMessage };
});

const { sentryAlertSink } = await import('./alerts');
const { logger } = await import('../log');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('sentryAlertSink', () => {
  it('only logs the alert, and loads no SDK, without a DSN', async () => {
    const log = vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    vi.stubEnv('SENTRY_DSN', '');
    sentryAlertSink.report('outbox.dead_lettered', { count: 1, ids: ['a'] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(log).toHaveBeenCalledWith('error', 'outbox.dead_lettered', { count: 1, ids: ['a'] });
    expect(sentry.loaded).toBe(0);
    expect(sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('sends one message named by the alert, with counts and ids only, when a DSN is set', async () => {
    vi.spyOn(logger, 'log').mockImplementation(() => undefined);
    vi.stubEnv('SENTRY_DSN', 'https://publickey@o4501.ingest.us.sentry.io/4502');
    sentryAlertSink.report('outbox.publisher_failing', { runs: 3, failed: 2 });
    await vi.waitFor(() => {
      expect(sentry.captureMessage).toHaveBeenCalledWith('outbox.publisher_failing', {
        level: 'error',
        fingerprint: ['outbox.publisher_failing'],
        extra: { runs: 3, failed: 2 },
      });
    });
  });
});
