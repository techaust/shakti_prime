import { Skeleton } from '@shakti/ui';

/**
 * The skeleton of a screen while its first page is on its way (docs/08-design-system.md §6: never a spinner):
 * the heading and a list, inside the shell's content area, which gives the gutters.
 */
export function ScreenSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex w-full flex-col gap-6" aria-busy>
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
