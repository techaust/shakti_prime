import * as Sentry from '@sentry/react-native';
import { appVersion } from '../config';
import { scrubBreadcrumb, scrubEvent } from './sentry-scrub';

/**
 * Sentry for the field app (docs/07-security.md §5), started once from the app's frame. It runs
 * only in a build that names a DSN (`EXPO_PUBLIC_SENTRY_DSN`, set per EAS profile); without one
 * nothing is sent. Every event, transaction and breadcrumb the JavaScript side sends passes
 * through the same scrubbing as the website's (`sentry-scrub.ts`), the SDK sends no personal data
 * of its own (`sendDefaultPii` off by default), and no screenshot, view hierarchy, session replay,
 * console log or failed request body is attached. A native Android crash skips the scrub and
 * carries the scope the SDK copies from JavaScript, so the app sets nothing on Sentry's scope (no
 * user, tags, extra or contexts); its breadcrumbs are scrubbed before they are kept (SECURITY §2,
 * Mobile).
 */
let started = false;

export interface SentrySettings {
  dsn?: string;
  environment?: string;
}

/**
 * The build's settings. Expo writes an `EXPO_PUBLIC_` variable into the bundle only where the code
 * names it in full as `process.env.EXPO_PUBLIC_…`, so each is read here by its own name.
 */
function buildSettings(): SentrySettings {
  const dsn: unknown = process.env.EXPO_PUBLIC_SENTRY_DSN;
  const environment: unknown = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;
  return {
    ...(typeof dsn === 'string' ? { dsn } : {}),
    ...(typeof environment === 'string' ? { environment } : {}),
  };
}

/** Starts Sentry once; answers whether it runs. */
export function startSentry(settings: SentrySettings = buildSettings()): boolean {
  const dsn = settings.dsn?.trim() ?? '';
  if (started) return true;
  if (dsn === '') return false;
  started = true;
  const environment = settings.environment?.trim() ?? '';
  Sentry.init({
    dsn,
    release: `shakti-field@${appVersion()}`,
    ...(environment === '' ? {} : { environment }),
    // `sendDefaultPii` is left at its default, off: the React Native SDK takes no `dataCollection`
    // and marks the setting itself as going away, so it is not named here.
    attachScreenshot: false,
    attachViewHierarchy: false,
    enableCaptureFailedRequests: false,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
  return true;
}
