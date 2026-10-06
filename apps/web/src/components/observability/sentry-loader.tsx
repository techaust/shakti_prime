'use client';

import { useEffect } from 'react';
import type { SentrySettings } from '../../observability/sentry-options';

/** How long the browser may wait for an idle moment before Sentry starts anyway. */
const IDLE_TIMEOUT_MS = 5_000;

/**
 * Starts browser error reporting after the page is interactive (docs/03-roadmap-appendix/phase1.md §5.2): the
 * SDK is fetched on the first idle moment, as a chunk of its own, so it adds nothing to any page's
 * first load; this loader is the only part every page carries. Without a DSN (the root layout
 * reads `NEXT_PUBLIC_SENTRY_DSN` on the server) nothing is fetched. The browser reads no
 * environment variable itself, which would bring a `process` stand-in into every page.
 */
export function SentryLoader({ settings }: { settings: SentrySettings }) {
  const { dsn, release, environment } = settings;
  useEffect(() => {
    if (dsn === undefined) return;
    let cancelled = false;
    const start = () => {
      if (cancelled) return;
      void import('../../observability/sentry-browser')
        .then((m) => {
          m.startBrowserSentry({ dsn, release, environment });
        })
        .catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(handle);
      };
    }
    const timer = window.setTimeout(start, 1);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dsn, release, environment]);
  return null;
}
