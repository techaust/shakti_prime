'use client';

import type { Theme } from '@shakti/contracts';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';
import { THEME_STORAGE_KEY } from '../theme';

/** Theme behaviour from DESIGN.md §7: System by default, Light/Dark override, no flash. */
export function Providers({
  children,
  defaultTheme,
  nonce,
}: {
  children: ReactNode;
  defaultTheme: Theme;
  /** The request's CSP nonce, for the inline script that applies the theme before paint. */
  nonce: string;
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
    </ThemeProvider>
  );
}
