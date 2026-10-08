import { cn } from '@shakti/ui';
import type { ReactNode } from 'react';

/** Content widths (docs/08-design-system.md §5): forms 720 px, detail pages 1200 px, grids and boards full. */
const WIDTHS = {
  form: 'max-w-form',
  detail: 'max-w-detail',
  full: 'max-w-none',
} as const;

export type PageWidth = keyof typeof WIDTHS;

/**
 * A screen inside the app shell: its heading (one `h1`, which names the screen), an optional
 * line under it, actions on the right, and the content at the width its kind of page takes.
 */
export function Page({
  title,
  description,
  actions,
  width = 'full',
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  width?: PageWidth;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('mx-auto flex w-full flex-col gap-6', WIDTHS[width], className)}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-h1 tracking-[-0.01em]">{title}</h1>
          {description === undefined ? null : <p className="text-text-muted">{description}</p>}
        </div>
        {actions === undefined ? null : (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </div>
  );
}
