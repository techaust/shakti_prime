import { Skeleton, cn } from '@shakti/ui';
import type { ReactNode } from 'react';

/**
 * One BOS screen inside the app shell: the title, a line on what the screen is for, the screen's
 * main action on the right (below the title on phones) and the content. `width` follows
 * DESIGN.md §5: forms 720 px, detail pages 1200 px, grids the full width.
 */
export function Screen({
  title,
  intro,
  actions,
  width = 'full',
  children,
}: {
  title: ReactNode;
  intro?: ReactNode;
  actions?: ReactNode;
  width?: 'form' | 'detail' | 'full';
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-col gap-6 px-4 py-6 md:px-6',
        width === 'form' && 'max-w-form',
        width === 'detail' && 'max-w-detail',
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-h1 tracking-[-0.01em]">{title}</h1>
          {intro === undefined ? null : <p className="text-text-muted">{intro}</p>}
        </div>
        {actions === undefined ? null : (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        )}
      </div>
      {children}
    </div>
  );
}

/** The skeleton of a screen while its first page is on its way (DESIGN.md §6: never a spinner). */
export function ScreenSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex w-full flex-col gap-6 px-4 py-6 md:px-6" aria-busy>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="border-border bg-surface flex flex-col rounded-lg border">
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className="border-border flex h-row items-center gap-4 border-b px-3 last:border-b-0"
          >
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-1/6" />
          </div>
        ))}
      </div>
    </div>
  );
}
