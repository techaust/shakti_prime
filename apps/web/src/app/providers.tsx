'use client';

import type { Theme } from '@shakti/contracts';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';
import { SentryLoader } from '../components/observability/sentry-loader';
import type { SentrySettings } from '../observability/sentry-options';
import { THEME_STORAGE_KEY } from '../theme';

/**
 * Theme behaviour from docs/08-design-system.md §7: System by default, Light/Dark override, no flash; and browser
 * error reporting, started after the page is idle when a DSN is set.
 */
export function Providers({
  children,
  defaultTheme,
  nonce,
  sentry,
}: {
  children: ReactNode;
  defaultTheme: Theme;
  /** The request's CSP nonce, for the inline script that applies the theme before paint. */
  nonce: string;
  sentry: SentrySettings;
}) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme={defaultTheme}
      enableSystem
      storageKey={THEME_STORAGE_KEY}
      disableTransitionOnChange
      nonce={nonce}
    >
      {children}
      <SentryLoader settings={sentry} />
    </ThemeProvider>
  );
}
