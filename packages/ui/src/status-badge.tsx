import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from './cn';

/** Status badge (DESIGN.md §6): a soft tint with the base status colour as text, 12 px. */
export const statusBadgeVariants = cva(
  'inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-xs font-[510] whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-2 text-text-muted',
        accent: 'bg-accent-soft text-accent-text',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
        info: 'bg-info-soft text-info',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type StatusTone = NonNullable<VariantProps<typeof statusBadgeVariants>['tone']>;

export function StatusBadge({
  tone,
  className,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof statusBadgeVariants>) {
  return <span {...props} className={cn(statusBadgeVariants({ tone }), className)} />;
}
