import { afterEach, describe, expect, it, vi } from 'vitest';

const sentry = vi.hoisted(() => {
  const scope = {
    setLevel: vi.fn(),
    setFingerprint: vi.fn(),
    setTag: vi.fn(),
    setExtras: vi.fn(),
  };
  return {
    scope,
    captureException: vi.fn(),
    flush: vi.fn(() => Promise.resolve(true)),
    withScope: vi.fn((run: (s: typeof scope) => void) => {
      run(scope);
    }),
  };
});
vi.mock('@sentry/nextjs', () => ({
  captureException: sentry.captureException,
  flush: sentry.flush,
  withScope: sentry.withScope,
}));
const next = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock('next/server', () => ({ after: next.after }));

const { logger } = await import('../log');
const { flushErrorReports } = await import('./error-reports');

const DSN = 'https://publickey@o4501.ingest.us.sentry.io/4502';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

/** Keeps the logger's lines off the test output. */
function quiet() {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

describe('error lines reach Sentry (audit 2026-10, OPS-3)', () => {
  it('sends nothing without a DSN', async () => {
    quiet();
    vi.stubEnv('SENTRY_DSN', '');
    logger.log('error', 'crm.rescore_failed', { requestId: 'r1', error: new Error('boom') });
    await flushErrorReports();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('sends an error line as its error, redacted, grouped by its event, and flushes it', async () => {
    quiet();
    vi.stubEnv('SENTRY_DSN', DSN);
    const error = new Error('no row for 9876543210 at https://bos.example.in/set?token=abc');
    logger.log('error', 'sales.quote_expiry_failed', { requestId: 'r2', error, entityId: 1 });
    await flushErrorReports();
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const sent = sentry.captureException.mock.calls[0]?.[0] as Error;
    expect(sent).toBeInstanceOf(Error);
    expect(sent.message).not.toContain('9876543210');
    expect(sent.message).not.toContain('token=abc');
    expect(sent.stack?.split('\n')[0]).toBe(`Error: ${sent.message}`);
    expect(sentry.scope.setFingerprint).toHaveBeenCalledWith(['sales.quote_expiry_failed']);
    expect(sentry.scope.setTag).toHaveBeenCalledWith('requestId', 'r2');
    expect(sentry.scope.setExtras).toHaveBeenCalledWith({ requestId: 'r2', entityId: 1 });
    expect(sentry.flush).toHaveBeenCalledWith(2_000);
    // In a request, the send is kept alive past the answer.
    expect(next.after).toHaveBeenCalledTimes(1);
  });

  it('sends a line with no error under its event name', async () => {
    quiet();
    vi.stubEnv('SENTRY_DSN', DSN);
    logger.log('error', 'files.sweep_failed', { requestId: 'r3' });
    await flushErrorReports();
    const sent = sentry.captureException.mock.calls[0]?.[0] as Error;
    expect(sent.message).toBe('files.sweep_failed');
  });

  it('leaves warnings, alerts and unhandled request errors to their own paths', async () => {
    quiet();
    vi.stubEnv('SENTRY_DSN', DSN);
    logger.log('warn', 'crm.rescore_busy', { requestId: 'r4' });
    logger.log('error', 'outbox.dead_lettered', { count: 1 });
    logger.log('error', 'request.failed', { requestId: 'r5' });
    await flushErrorReports();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('never throws outside a request, where after() is not available', async () => {
    quiet();
    vi.stubEnv('SENTRY_DSN', DSN);
    next.after.mockImplementationOnce(() => {
      throw new Error('after was called outside a request scope');
    });
    expect(() => {
      logger.log('error', 'notifications.due.scan_failed', { requestId: 'r6' });
    }).not.toThrow();
    await flushErrorReports();
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
