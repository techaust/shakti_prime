import type { ReactNode } from 'react';
import { cn } from './cn';

/** Empty state (docs/08-design-system.md §6): one sentence and at most one primary action. */
export function EmptyState({
  message,
  action,
  icon,
  className,
}: {
  message: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'border-border flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed px-6 py-12 text-center',
        className,
      )}
    >
      {icon === undefined ? null : (
        <span aria-hidden className="text-text-subtle [&_svg]:size-6">
          {icon}
        </span>
      )}
      <p className="text-text-muted max-w-sm">{message}</p>
      {action ?? null}
    </div>
  );
}
