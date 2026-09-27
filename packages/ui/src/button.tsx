'use client';

import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from './cn';

/**
 * Buttons (DESIGN.md §6): primary is the accent fill, secondary a surface with a border, ghost
 * and danger for quiet and destructive actions, link for text-style actions. 36 px on desktop,
 * 44 px on phones; icon buttons are square.
 */
export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-[510] whitespace-nowrap',
    'transition-colors duration-(--motion-fast) ease-out select-none',
    'disabled:opacity-60 aria-disabled:opacity-60 aria-disabled:cursor-not-allowed disabled:cursor-not-allowed',
    '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
        secondary: 'bg-surface text-text border-border-strong hover:bg-highlight border',
        ghost: 'text-text hover:bg-highlight bg-transparent',
        danger: 'bg-danger text-danger-soft hover:bg-danger/90',
        link: 'text-accent-text min-h-control self-start px-0 underline-offset-4 hover:underline max-md:min-h-control-phone',
      },
      size: {
        default: 'h-control px-4 max-md:h-control-phone',
        sm: 'h-8 px-3 text-sm max-md:h-control-phone',
        icon: 'size-control max-md:size-control-phone',
      },
    },
    compoundVariants: [{ variant: 'link', className: 'h-auto px-0' }],
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Renders the child element (a link, say) with the button's look. */
  asChild?: boolean;
  /**
   * While an answer is on its way: the label stays, so the button keeps its width, a spinner
   * shows over it, the button stays focusable and a second press does nothing (AUDIT M50).
   */
  pending?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  pending = false,
  children,
  onClick,
  ...props
}: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) {
    return (
      <Slot className={classes} {...props}>
        {children}
      </Slot>
    );
  }
  return (
    <button
      type="button"
      {...props}
      aria-disabled={pending || props.disabled === true || undefined}
      aria-busy={pending || undefined}
      onClick={(e) => {
        if (pending) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={classes}
    >
      <span className={cn('inline-flex items-center gap-2', pending && 'invisible')}>
        {children}
      </span>
      {pending ? (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center">
          <LoaderCircle className="animate-spin motion-reduce:animate-none" />
        </span>
      ) : null}
    </button>
  );
}
