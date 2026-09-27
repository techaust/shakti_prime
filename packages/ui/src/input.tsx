'use client';

import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from './cn';
import { useFieldControl } from './field';

/** Inputs, selects and date inputs share one look: 36 px, the strong border, label above. */
export const controlClasses = cn(
  'bg-surface text-text border-border-strong h-control w-full min-w-0 rounded-md border px-3',
  'placeholder:text-text-subtle transition-colors duration-(--motion-fast) ease-out',
  'disabled:bg-surface-2 disabled:text-text-muted disabled:cursor-not-allowed',
  'aria-invalid:border-danger max-md:h-control-phone',
);

/** The props a control takes from its `Field`, with the control's own props winning. */
export function useControlProps(
  props: { id?: string | undefined; 'aria-describedby'?: string | undefined },
  invalid: boolean | undefined,
): {
  id: string | undefined;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
} {
  const field = useFieldControl();
  const isInvalid = invalid ?? field?.invalid ?? false;
  return {
    id: props.id ?? field?.id,
    'aria-invalid': isInvalid || undefined,
    'aria-describedby': props['aria-describedby'] ?? field?.describedBy,
  };
}

export interface InputProps extends ComponentProps<'input'> {
  /** Marks the control wrong; inside a `Field` it follows the field's error by default. */
  invalid?: boolean | undefined;
}

export function Input({ className, invalid, ...props }: InputProps) {
  const control = useControlProps(props, invalid);
  return <input {...props} {...control} className={cn(controlClasses, className)} />;
}

export interface SelectProps extends ComponentProps<'select'> {
  invalid?: boolean | undefined;
}

/**
 * A native select with the control look: the phone's own picker opens on touch, and keyboard
 * and screen-reader behaviour come from the browser.
 */
export function Select({ className, invalid, children, ...props }: SelectProps) {
  const control = useControlProps(props, invalid);
  return (
    <span className="relative flex w-full">
      <select
        {...props}
        {...control}
        className={cn(controlClasses, 'appearance-none pr-9', className)}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="text-text-muted pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
      />
    </span>
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: ComponentProps<'textarea'> & { invalid?: boolean }) {
  const control = useControlProps(props, invalid);
  return (
    <textarea
      {...props}
      {...control}
      className={cn(controlClasses, 'h-auto min-h-20 py-2 max-md:h-auto', className)}
    />
  );
}
