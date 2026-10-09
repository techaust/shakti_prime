'use client';

import { CircleAlert } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { cn } from './cn';

interface FieldControl {
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldControl | undefined>(undefined);

/** The ids of the helper and error lines under a field, for `aria-describedby`. */
export function fieldIds(id: string): { helper: string; error: string } {
  return { helper: `${id}-helper`, error: `${id}-error` };
}

/**
 * What the control inside a `Field` takes from it: its id, the lines that describe it and
 * whether it is marked wrong. Props given to the control itself win.
 */
export function useFieldControl(): FieldControl | undefined {
  return useContext(FieldContext);
}

/**
 * A labelled control (docs/08-design-system.md §6): the label above, a helper line or an error below. The error
 * is in the danger colour with an icon, so it does not rely on colour alone. Buttons that act on the
 * control (Search, Clear) go in `actions`, on the control's own line and centred on it, so a helper
 * or an error below never moves them out of line with the box.
 */
export function Field({
  id,
  label,
  helper,
  error,
  actions,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  helper?: ReactNode;
  /** A sentence from the message catalogue; its presence marks the control wrong. */
  error?: ReactNode;
  /** Buttons beside the control, level with it (docs/08-design-system.md §6, a field with its action). */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const ids = fieldIds(id);
  const hasError = error !== undefined && error !== null && error !== false && error !== '';
  const describedBy =
    [hasError ? ids.error : undefined, helper === undefined ? undefined : ids.helper]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: hasError }}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <label htmlFor={id} className="text-text-muted text-sm font-medium">
          {label}
        </label>
        {actions === undefined ? (
          children
        ) : (
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">{children}</div>
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          </div>
        )}
        {helper === undefined ? null : (
          <p id={ids.helper} className="text-text-subtle text-xs">
            {helper}
          </p>
        )}
        {hasError ? (
          <p id={ids.error} className="text-danger flex items-start gap-1.5 text-sm">
            <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
