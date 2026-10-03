import * as Sentry from '@sentry/nextjs';
import { sentryInitOptions, type SentrySettings } from './sentry-options';

/**
 * Starts Sentry in the browser. Loaded by `SentryLoader` once the page is idle, so no page's
 * first-load JavaScript carries the SDK.
 */
export function startBrowserSentry(settings: SentrySettings): void {
  const options = sentryInitOptions(settings);
  if (options === undefined) return;
  Sentry.init(options);
}
