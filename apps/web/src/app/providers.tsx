'use client';

import type { Theme } from '@shakti/contracts';
import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';
import { THEME_STORAGE_KEY } from '../theme';

/** Theme behaviour from DESIGN.md §7: System by default, Light/Dark override, no flash. */
export function Providers({
  children,
  defaultTheme,
}: {
  children: ReactNode;
  defaultTheme: Theme;
}) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme={defaultTheme}
      enableSystem
      storageKey={THEME_STORAGE_KEY}
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
