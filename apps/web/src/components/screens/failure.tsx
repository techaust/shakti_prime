'use client';

import { useTranslations } from 'next-intl';
import { useId } from 'react';
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
    fieldError: (name: string) =>
      failure !== undefined && owner === name ? sentence(failure.error) : undefined,
    /** The failure for the alert under the form: every failure no field of the form shows. */
    formFailure: owner === undefined ? failure : undefined,
  };
}
