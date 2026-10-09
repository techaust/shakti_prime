'use client';

import { useScrolls } from '@shakti/ui';
import type { ReactNode } from 'react';

/**
 * A bordered, labelled region around a table. It takes keyboard focus only while the table is
 * wider than its box, so the keyboard can scroll it (WCAG 2.1.1) and a table that fits is no tab
 * stop.
 */
export function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  const [box, scrolls] = useScrolls();
  return (
    <div
      ref={box}
      role="region"
      aria-label={label}
      tabIndex={scrolls ? 0 : undefined}
      className="border-border bg-surface focus-visible:outline-focus overflow-x-auto rounded-lg border focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {children}
    </div>
  );
}
