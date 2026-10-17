// Sentry's settings for the server, the edge and the browser (docs/03-roadmap-appendix/phase1.md §5.2): the
// group's US-region organisation, with personal data removed before an event is sent. No DSN,
// no Sentry: locally and in CI nothing is started.

import { ALERT_NAMES } from './sentry-on';
import { scrubBreadcrumb, scrubEvent } from './sentry-scrub';

/**
 * The share of errors dev and staging send. Sentry stays on its free plan for good (DECISIONS,
 * 15-10-2026), whose monthly allowance production needs, so production sends every error and
 * dev and staging one in five. The four alerts (`ALERT_NAMES`) are always sent.
 */
export const TRIAL_ERROR_SHARE = 0.2;
const TRIAL_ENVIRONMENTS: ReadonlySet<string> = new Set(['dev', 'staging']);
const ALERTS: ReadonlySet<string> = new Set(ALERT_NAMES);

/** Whether an event is kept: every one on production, every alert, else a share on dev and staging. */
export function keepsEvent(
  environment: string | undefined,
  event: object,
  random: () => number = Math.random,
): boolean {
  if (environment === undefined || !TRIAL_ENVIRONMENTS.has(environment)) return true;
  const message = (event as { message?: unknown }).message;
  if (typeof message === 'string' && ALERTS.has(message)) return true;
  return random() < TRIAL_ERROR_SHARE;
}

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
 * event, transaction and breadcrumb passes through the scrubber first. Dev and staging drop all
 * but a share of their errors (`keepsEvent`).
 */
export function sentryInitOptions(settings: SentrySettings, random: () => number = Math.random) {
  if (settings.dsn === undefined) return undefined;
  return {
    dsn: settings.dsn,
    ...(settings.release === undefined ? {} : { release: settings.release }),
    ...(settings.environment === undefined ? {} : { environment: settings.environment }),
    sendDefaultPii: false,
    maxBreadcrumbs: 50,
    beforeSend: <E extends object>(event: E): E | null =>
      keepsEvent(settings.environment, event, random) ? scrubEvent(event) : null,
    beforeSendTransaction: <E extends object>(event: E): E => scrubEvent(event),
    beforeBreadcrumb: <B extends object>(breadcrumb: B): B => scrubBreadcrumb(breadcrumb),
  };
}
