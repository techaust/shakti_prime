import type { ComponentProps } from 'react';
import { cn } from './cn';

/**
 * A grey block in the shape of content that is still loading (DESIGN.md §6): never a spinner
 * for content. The pulse stops for people who ask for reduced motion.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden
      {...props}
      className={cn('bg-surface-3 animate-pulse rounded-sm motion-reduce:animate-none', className)}
    />
  );
}
