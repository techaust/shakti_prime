'use client';

import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

/** Theme behaviour from DESIGN.md §7: System by default, Light/Dark override, no flash. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
