'use client';

import type { ComponentProps } from 'react';

/**
 * The button of the public screens and the root error screen (docs/08-design-system.md §6), kept
 * apart from `form.tsx` so a screen that needs only the button loads nothing else.
 */
export function Button({
  children,
  variant = 'primary',
  pending = false,
  className = '',
  onClick,
  ...props
}: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'link'; pending?: boolean }) {
  // Controls are 36 px on desktop and 44 px on phones (docs/08-design-system.md §6); a text-style button keeps
  // the same touch target.
  const look = {
    primary: 'bg-accent text-accent-fg hover:bg-accent-hover h-9 px-4 max-md:h-11',
    secondary:
      'bg-surface text-text border-border-strong hover:bg-surface-3 h-9 border px-4 max-md:h-11',
    link: 'text-accent-text min-h-9 self-start px-0 underline-offset-4 hover:underline max-md:min-h-11',
  }[variant];
  return (
    <button
      {...props}
      // While an answer is on its way the button stays focusable, so focus is not lost, and a
      // second press does nothing (AUDIT M50).
      aria-disabled={pending || props.disabled === true || undefined}
      disabled={props.disabled}
      aria-busy={pending || undefined}
      onClick={(e) => {
        if (pending) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={`rounded-md font-medium disabled:opacity-60 aria-disabled:opacity-60 ${look} ${className}`}
    >
      {children}
    </button>
  );
}
