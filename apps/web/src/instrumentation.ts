import type { Instrumentation } from 'next';

/**
 * Runs once when a server instance starts. A hosted deployment with an unsafe configuration
 * refuses to start here, before it serves anything (AUDIT M8), instead of on the first sign-in.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { assertProductionConfig, hostedRuntime } = await import('./auth/deps');
  if (hostedRuntime()) assertProductionConfig();
}

/**
 * Every error a request did not handle (AUDIT M35): one redacted log line with the reference the
 * error screen shows, derived from the same digest, and the platform's request id.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const [{ logger }, { referenceFromDigest }] = await Promise.all([
    import('./log'),
    import('./reference'),
  ]);
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error ? error.digest : undefined;
  const header = (name: string) => {
    const value = request.headers[name];
    return typeof value === 'string' ? value : undefined;
  };
  logger.log('error', 'request.failed', {
    reference: typeof digest === 'string' ? referenceFromDigest(digest) : undefined,
    requestId: header('x-request-id') ?? header('x-vercel-id'),
    method: request.method,
    path: request.path.split('?')[0],
    route: context.routePath,
    routeType: context.routeType,
    error,
  });
};
