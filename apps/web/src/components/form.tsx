import { useTranslations } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';

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

export function TextInput(props: ComponentProps<'input'>) {
  return (
    <input
      {...props}
      className="bg-surface border-border-strong text-text h-9 rounded-[var(--radius-md)] border px-3"
    />
  );
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: ComponentProps<'button'> & { variant?: 'primary' | 'secondary' }) {
  const look =
    variant === 'primary'
      ? 'bg-accent text-accent-fg hover:bg-accent-hover'
      : 'bg-surface text-text border-border-strong border';
  return (
    <button
      {...props}
      className={`h-9 rounded-[var(--radius-md)] px-4 font-medium disabled:opacity-60 ${look}`}
    >
      {children}
    </button>
  );
}

/** A catalogue error under `errors.*`, or nothing. */
export function FormError({ errorKey }: { errorKey: string | undefined }) {
  const t = useTranslations('errors');
  if (errorKey === undefined) return null;
  const known = t.has(errorKey) ? errorKey : 'internal';
  return (
    <p role="alert" className="text-danger text-sm">
      {t(known)}
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
        <h1 className="text-[length:var(--font-h1-size)] leading-[var(--font-h1-line)] font-semibold">
          {title}
        </h1>
        {intro === undefined ? null : <p className="text-text-muted">{intro}</p>}
      </div>
      {children}
    </main>
  );
}
