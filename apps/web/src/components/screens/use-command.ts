'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import type { ActionResult } from '../../actions/result';
import { settle } from './settle';

/** A failed answer as a form shows it: the catalogue key, the reference and the field. */
export interface CommandFailure {
  error: string;
  reference?: string | undefined;
  field?: string | undefined;
  /** Counts failures, so the alert is announced again after another failed try (AUDIT M50). */
  attempt: number;
}

/** The idempotency key a form sends (docs/06-api.md §1), and the form it was made for. */
export interface FormKey {
  form: string | undefined;
  key: string;
}

/**
 * The key for the next send of `form`: the last key while the form is the same and not yet saved,
 * so a double press or a retry after a lost answer acts once; a new key for another form (another
 * lead in one workspace) or after a save (`last` is then undefined).
 */
export function formKeyFor(
  last: FormKey | undefined,
  form: string | undefined,
  fresh: () => string,
): FormKey {
  return last !== undefined && last.form === form ? last : { form, key: fresh() };
}

/**
 * Runs a command action from a form or a confirmation (docs/06-api.md §1): one idempotency key per
 * rendered form, sent as the action's second argument, so a double press or a retry after a lost
 * answer acts once. A form is rendered afresh (a dialog opens again, a page loads) for the next
 * change, which gives it a new key; after a failure the key stays, because nothing was stored. A
 * screen that shows one form after another without rendering it afresh (the calling workspace's
 * leads) names the form it shows in `form`: another form gets a new key and none of the last
 * one's failure. A call whose answer never arrives is shown as the `internal` sentence, not the
 * error boundary.
 */
export function useCommand<T, I = unknown>(
  action: (input: I, idempotencyKey?: unknown) => Promise<ActionResult<T>>,
  form?: string,
) {
  const sent = useRef<FormKey | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<{ form: string | undefined; failure: CommandFailure }>();

  const run = useCallback(
    (input: I, onDone: (data: T) => void) => {
      const current = formKeyFor(sent.current, form, () => crypto.randomUUID());
      sent.current = current;
      startTransition(async () => {
        const result = await settle(() => action(input, current.key));
        if (result.ok) {
          setFailed(undefined);
          if (sent.current === current) sent.current = undefined;
          onDone(result.data);
          return;
        }
        setFailed((previous) => ({
          form,
          failure: {
            error: result.error,
            reference: result.reference,
            field: result.field,
            attempt: (previous?.failure.attempt ?? 0) + 1,
          },
        }));
      });
    },
    [action, form],
  );

  return { run, pending, failure: failed?.form === form ? failed?.failure : undefined };
}

/**
 * A read action's answer for a client list: the data, or the failure to show in place of it. A
 * list never throws to the screen, because Next.js masks thrown errors in production.
 */
export function useQuery<T>() {
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<CommandFailure | undefined>();
  const load = useCallback((read: () => Promise<ActionResult<T>>, onDone: (data: T) => void) => {
    startTransition(async () => {
      const result = await settle(read);
      if (result.ok) {
        setFailure(undefined);
        onDone(result.data);
        return;
      }
      setFailure((previous) => ({
        error: result.error,
        reference: result.reference,
        field: result.field,
        attempt: (previous?.attempt ?? 0) + 1,
      }));
    });
  }, []);
  return { load, pending, failure };
}
