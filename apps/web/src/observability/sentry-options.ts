// Sentry's settings for the server, the edge and the browser (docs/design/phase1.md §5.2): the
// group's US-region organisation, with personal data removed before an event is sent. No DSN,
// no Sentry: locally and in CI nothing is started.

import { scrubBreadcrumb, scrubEvent } from './sentry-scrub';

export interface SentrySettings {
  dsn: string | undefined;
  /** The commit (`VERCEL_GIT_COMMIT_SHA`), so an event names the build it came from. */
  release: string | undefined;
  /** `BOS_ENVIRONMENT`: dev, staging or production. */
  environment: string | undefined;
}

const given = (value: string | undefined): string | undefined =>
  value === undefined || value.trim() === '' ? undefined : value.trim();

/** The server's and the edge's settings, from their own variables. */
export function serverSentrySettings(env: NodeJS.ProcessEnv = process.env): SentrySettings {
  return {
    dsn: given(env.SENTRY_DSN),
    release: given(env.VERCEL_GIT_COMMIT_SHA),
    environment: given(env.BOS_ENVIRONMENT),
  };
}

/** The browser's settings, which the root layout hands to the loader. */
export function browserSentrySettings(env: NodeJS.ProcessEnv = process.env): SentrySettings {
  return {
    dsn: given(env.NEXT_PUBLIC_SENTRY_DSN),
    release: given(env.VERCEL_GIT_COMMIT_SHA),
    environment: given(env.BOS_ENVIRONMENT),
  };
}

/**
 * The options `Sentry.init` takes, or undefined without a DSN. `sendDefaultPii` is off, and every
 * event, transaction and breadcrumb passes through the scrubber first.
 */
export function sentryInitOptions(settings: SentrySettings) {
  if (settings.dsn === undefined) return undefined;
  return {
    dsn: settings.dsn,
    ...(settings.release === undefined ? {} : { release: settings.release }),
    ...(settings.environment === undefined ? {} : { environment: settings.environment }),
    sendDefaultPii: false,
    maxBreadcrumbs: 50,
    beforeSend: <E extends object>(event: E): E => scrubEvent(event),
    beforeSendTransaction: <E extends object>(event: E): E => scrubEvent(event),
    beforeBreadcrumb: <B extends object>(breadcrumb: B): B => scrubBreadcrumb(breadcrumb),
  };
}
