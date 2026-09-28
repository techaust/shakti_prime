'use client';

import { useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type SyntheticEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import type { ErrorKey } from '../i18n/types';

/**
 * Form primitives on the DESIGN.md §6 rules for the public sign-in screens, the error screen and
 * the set-password and two-factor flows, written before the component library `@shakti/ui`; the
 * signed-in screens use `@shakti/ui`.
 */

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

/**
 * What a form needs to report an answer (AUDIT M50, L15): its own error id (a page can hold two
 * forms), a count of attempts so a repeated error is announced again, and the form element, so
 * focus moves to the first field the answer marks as wrong.
 */
export function useFormFeedback(state: object): {
  errorId: string;
  attempt: number;
  formRef: RefObject<HTMLFormElement | null>;
} {
  const errorId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [attempt, setAttempt] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setAttempt((n) => n + 1);
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [state]);
  return { errorId, attempt, formRef };
}

/** The catalogue sentence for a field the browser finds invalid (AUDIT L34). */
function validityMessage(
  input: HTMLInputElement,
  t: ReturnType<typeof useTranslations<'fields'>>,
): string {
  const v = input.validity;
  if (v.valueMissing) return t('required');
  if (v.typeMismatch && input.type === 'email') return t('email');
  if (v.tooShort) return t('tooShort', { min: input.minLength });
  if (v.patternMismatch) return t('pattern');
  return t('invalid');
}

export function TextInput({
  className = '',
  invalid = false,
  errorId,
  onInvalid,
  onInput,
  ...props
}: ComponentProps<'input'> & { invalid?: boolean; errorId?: string }) {
  const t = useTranslations('fields');
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? errorId : undefined}
      // The browser's own messages are in its language and words; ours come from the catalogue.
      onInvalid={(e) => {
        e.currentTarget.setCustomValidity(validityMessage(e.currentTarget, t));
        onInvalid?.(e);
      }}
      onInput={(e) => {
        e.currentTarget.setCustomValidity('');
        onInput?.(e);
      }}
      className={`bg-surface border-border-strong text-text h-9 rounded-[var(--radius-md)] border px-3 max-md:h-11 ${className}`}
    />
  );
}

export function Button({
  children,
  variant = 'primary',
  pending = false,
  className = '',
  onClick,
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
      className={`rounded-[var(--radius-md)] font-[510] disabled:opacity-60 aria-disabled:opacity-60 ${look} ${className}`}
    >
      {children}
    </button>
  );
}

/** Stops a submit while one is on its way, for forms whose button shows pending. */
export function blockWhilePending(pending: boolean) {
  return (e: SyntheticEvent<HTMLFormElement>) => {
    if (pending) e.preventDefault();
  };
}

/**
 * A catalogue error under `errors.*`, or nothing. An unexpected failure also shows the reference
 * the person reads to support (DESIGN.md §11). `attempt` remounts the alert, so a screen reader
 * announces the same sentence again after another failed try (AUDIT M50).
 */
export function FormError({
  errorKey,
  reference,
  id,
  attempt = 0,
}: {
  errorKey: string | undefined;
  reference?: string | undefined;
  id: string;
  attempt?: number;
}) {
  const t = useTranslations('errors');
  const app = useTranslations('app');
  if (errorKey === undefined) return null;
  // An action answers a string; only a key the catalogue has is shown, never a raw key path.
  const known: ErrorKey = t.has(errorKey as ErrorKey) ? (errorKey as ErrorKey) : 'internal';
  return (
    <p key={attempt} id={id} role="alert" className="text-danger text-sm">
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
