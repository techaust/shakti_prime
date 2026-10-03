import * as Sentry from '@sentry/nextjs';
import { sentryInitOptions, serverSentrySettings } from './sentry-options';

/**
 * Starts Sentry on the server or the edge when a DSN is set (`instrumentation.ts` imports this
 * module only then, so without one the SDK is never loaded).
 */
export function startServerSentry(): boolean {
  const options = sentryInitOptions(serverSentrySettings());
  if (options === undefined) return false;
  Sentry.init(options);
  return true;
}

/** Reports an error no request handled, tagged with the request's id, to Sentry. */
export function reportRequestError(
  error: unknown,
  request: Parameters<typeof Sentry.captureRequestError>[1],
  context: Parameters<typeof Sentry.captureRequestError>[2],
  requestId: string | undefined,
): void {
  Sentry.withScope((scope) => {
    if (requestId !== undefined) scope.setTag('requestId', requestId);
    Sentry.captureRequestError(error, request, context);
  });
}

/** Names the signed-in principal, by id only, on the events of this request. */
export function tagPrincipal(principalId: string): void {
  Sentry.setUser({ id: principalId });
  Sentry.setTag('principalId', principalId);
}
