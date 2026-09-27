import { useTranslations } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';
import type { ErrorKey } from '../i18n/types';

/** Minimal form primitives on the DESIGN.md §6 rules; the component library arrives in week 4. */

export function Field({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-text-muted text-sm">
        {label}
      </label>
      {children}
    </div>
  );
}

/** The id every form's error message carries, so inputs can point at it. */
export const FORM_ERROR_ID = 'form-error';

export function TextInput({
  className = '',
  invalid = false,
  ...props
}: ComponentProps<'input'> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? FORM_ERROR_ID : undefined}
      className={`bg-surface border-border-strong text-text h-9 rounded-[var(--radius-md)] border px-3 max-md:h-11 ${className}`}
    />
  );
}

export function Button({
  children,
  variant = 'primary',
  pending = false,
  className = '',
  ...props
}: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' | 'link'; pending?: boolean }) {
  // Controls are 36 px on desktop and 44 px on phones (DESIGN.md §6); a text-style button keeps
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
      disabled={pending || props.disabled}
      aria-busy={pending || undefined}
      className={`rounded-[var(--radius-md)] font-[510] disabled:opacity-60 ${look} ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * A catalogue error under `errors.*`, or nothing. An unexpected failure also shows the reference
 * the person reads to support (DESIGN.md §11).
 */
export function FormError({
  errorKey,
  reference,
}: {
  errorKey: string | undefined;
  reference?: string | undefined;
}) {
  const t = useTranslations('errors');
  const app = useTranslations('app');
  if (errorKey === undefined) return null;
  // An action answers a string; only a key the catalogue has is shown, never a raw key path.
  const known: ErrorKey = t.has(errorKey as ErrorKey) ? (errorKey as ErrorKey) : 'internal';
  return (
    <p id={FORM_ERROR_ID} role="alert" className="text-danger text-sm">
      {t(known)}
      {reference === undefined ? null : (
        <span className="block">{app('reference', { reference })}</span>
      )}
    </p>
  );
}

export function Card({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-[length:var(--font-h1-size)] leading-[var(--font-h1-line)] font-[590]">
          {title}
        </h1>
        {intro === undefined ? null : <p className="text-text-muted">{intro}</p>}
      </div>
      {children}
    </main>
  );
}
