import type { Instrumentation } from 'next';

/** Whether error reporting is on: Sentry starts, and is loaded at all, only with a DSN. */
function sentryOn(): boolean {
  const dsn = process.env.SENTRY_DSN;
  return dsn !== undefined && dsn.trim() !== '';
}

/**
 * Runs once when a server instance starts. A hosted deployment with an unsafe configuration
 * refuses to start here, before it serves anything (AUDIT M8), instead of on the first sign-in.
 * Sentry starts here on the server and the edge when `SENTRY_DSN` is set
 * (docs/03-roadmap-appendix/phase1.md §5.2); without it the SDK is never loaded.
 */
export async function register(): Promise<void> {
  const runtime = process.env.NEXT_RUNTIME;
  if (runtime === 'nodejs') {
    const { assertProductionConfig, hostedRuntime } = await import('./auth/deps');
    if (hostedRuntime()) assertProductionConfig();
  }
  if ((runtime === 'nodejs' || runtime === 'edge') && sentryOn()) {
    const { startServerSentry } = await import('./observability/sentry-server');
    startServerSentry();
  }
}

/**
 * Every error a request did not handle (AUDIT M35): one redacted log line with the reference the
 * error screen shows, derived from the same digest, and the platform's request id; with a DSN,
 * also one Sentry event tagged with that request id, scrubbed before it is sent.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const [{ logger }, { referenceFromDigest }, { platformRequestId }] = await Promise.all([
    import('./log'),
    import('./reference'),
    import('./auth/client-address'),
  ]);
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error ? error.digest : undefined;
  // The same choice and check as the audit trail: the platform's id first, a caller's only when
  // the platform set none, and never a header that is unsafe to write into a log line.
  const requestId = platformRequestId({
    get: (name) => {
      const value = request.headers[name];
      return typeof value === 'string' ? value : null;
    },
  });
  logger.log('error', 'request.failed', {
    reference: typeof digest === 'string' ? referenceFromDigest(digest) : undefined,
    requestId,
    method: request.method,
    path: request.path.split('?')[0],
    route: context.routePath,
    routeType: context.routeType,
    error,
  });
  if (sentryOn()) {
    const { reportRequestError } = await import('./observability/sentry-server');
    reportRequestError(error, request, context, requestId);
  }
};
