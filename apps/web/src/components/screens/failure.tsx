'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { ErrorKey } from '../../i18n/types';
import { FormError } from '../form';
import type { CommandFailure } from './use-command';

/**
 * The sentence for a failed answer, from the catalogue, with the reference of an unexpected one
 * (docs/08-design-system.md §11). Announced as an alert, and again after each further failed try.
 */
export function FailureMessage({ failure }: { failure: CommandFailure | undefined }) {
  const id = useId();
  return (
    <FormError
      id={id}
      errorKey={failure?.error}
      reference={failure?.reference}
      attempt={failure?.attempt ?? 0}
    />
  );
}

/**
 * A failure the server gives a field, as that field shows it (WEB-2, WCAG 3.3.1 and 4.1.3): read
 * out as an alert, and focus moved to the field's control, so a person who pressed Save hears what
 * is wrong and lands where the fix goes. Rendered afresh for each failed try (`attempt`), so a
 * further failure is read out and focused again. The control is the one the `Field` labels: its
 * error line is `<id>-error` (`fieldIds`).
 */
function FieldFailureSentence({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const line = ref.current?.closest<HTMLElement>('[id$="-error"]');
    if (line === null || line === undefined) return;
    document.getElementById(line.id.slice(0, -'-error'.length))?.focus();
  }, []);
  return (
    <span ref={ref} role="alert">
      {children}
    </span>
  );
}

/**
 * Where a form shows a failure: under the field it is about, when the form has that field, or
 * as one alert under the form. `fieldError(name)` is the sentence for the field, if it is the one.
 */
export function useFieldFailure(failure: CommandFailure | undefined, fields: readonly string[]) {
  const t = useTranslations('errors');
  const sentence = (key: string) => t(t.has(key as ErrorKey) ? (key as ErrorKey) : 'internal');
  const owner =
    failure?.field === undefined
      ? undefined
      : fields.find((f) => failure.field === f || failure.field?.startsWith(`${f}.`) === true);
  return {
    fieldError: (name: string): ReactNode =>
      failure !== undefined && owner === name ? (
        <FieldFailureSentence key={failure.attempt}>{sentence(failure.error)}</FieldFailureSentence>
      ) : undefined,
    /** The failure for the alert under the form: every failure no field of the form shows. */
    formFailure: owner === undefined ? failure : undefined,
  };
}
