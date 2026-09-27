import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The merger learns the token names from `@shakti/tokens/tailwind.css`: without them it reads
 * `text-h3` as a colour, and `cn('text-h3', 'text-text')` would drop the size.
 */
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['display', 'h1', 'h2', 'h3', 'body', 'body-dense', 'body-phone', 'caption', 'numeric'],
      spacing: [
        'sidebar',
        'sidebar-collapsed',
        'topbar',
        'control',
        'control-phone',
        'row',
        'row-compact',
      ],
      container: ['form', 'detail'],
    },
  },
});

/** Joins class names; a later Tailwind class of the same kind wins over an earlier one. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
