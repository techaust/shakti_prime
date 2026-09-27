'use client';

import { useCallback, useState, useTransition } from 'react';
import type { ActionResult } from '../../actions/result';

/** A failed answer as a form shows it: the catalogue key, the reference and the field. */
export interface CommandFailure {
  error: string;
  reference?: string | undefined;
  field?: string | undefined;
  /** Counts failures, so the alert is announced again after another failed try (AUDIT M50). */
  attempt: number;
}

/**
 * Runs a command action from a form or a confirmation (docs/API.md §1): one idempotency key per
 * rendered form, sent as the action's second argument, so a double press or a retry after a lost
 * answer acts once. A form is rendered afresh (a dialog opens again, a page loads) for the next
 * change, which gives it a new key; after a failure the key stays, because nothing was stored.
 */
export function useCommand<T, I = unknown>(
  action: (input: I, idempotencyKey?: unknown) => Promise<ActionResult<T>>,
) {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const [failure, setFailure] = useState<CommandFailure | undefined>();

  const run = useCallback(
    (input: I, onDone: (data: T) => void) => {
      startTransition(async () => {
        const result = await action(input, key);
        if (result.ok) {
          setFailure(undefined);
          setKey(crypto.randomUUID());
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
    },
    [action, key],
  );

  return { run, pending, failure };
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
      const result = await read();
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
