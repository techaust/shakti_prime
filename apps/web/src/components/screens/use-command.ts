'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import type { ActionResult } from '../../actions/result';
import { signInPath } from '../../session-gate';
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
 * Where a failed answer sends the person, if anywhere: an ended sign-in (`unauthorized`) goes to
 * sign-in, which brings them back to this screen afterwards (WEB-7, WEB-V1). Any other failure
 * stays on the screen.
 */
export function signInAfter(error: string, pathname: string): string | undefined {
  return error === 'unauthorized' ? signInPath(pathname, 'session_ended') : undefined;
}

/** Leaves for sign-in when the answer says the person's sign-in has ended. */
function leaveIfSignedOut(error: string): void {
  const to = signInAfter(error, window.location.pathname);
  if (to !== undefined) window.location.assign(to);
}

/**
 * The key for a run with `input` (its serialised details): the form's key, unless another run of
 * the same hook still waits for its answer under that key with other details (a second row's
 * button pressed while the first row's is in flight). That run gets a key of its own, so two
 * inputs never claim one key and the second is not refused as a mismatch (WEB-5). The same
 * details again (a double press) keep the key and act once.
 */
export function runKeyFor(
  last: FormKey | undefined,
  form: string | undefined,
  input: string,
  inFlight: ReadonlyMap<string, string>,
  fresh: () => string,
): FormKey {
  const key = formKeyFor(last, form, fresh);
  for (const [details, flying] of inFlight) {
    if (flying === key.key && details !== input) return { form, key: fresh() };
  }
  return key;
}

/** An input's details, to tell a double press from another row's run. */
function detailsOf(input: unknown): string {
  try {
    return String(JSON.stringify(input));
  } catch {
    return '';
  }
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
  // The runs waiting for their answer: their details and the key each was sent with.
  const inFlight = useRef(new Map<string, string>());
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState<{ form: string | undefined; failure: CommandFailure }>();

  const run = useCallback(
    (input: I, onDone: (data: T) => void) => {
      const details = detailsOf(input);
      const current = runKeyFor(sent.current, form, details, inFlight.current, () =>
        crypto.randomUUID(),
      );
      sent.current = current;
      inFlight.current.set(details, current.key);
      startTransition(async () => {
        const result = await settle(() => action(input, current.key));
        if (inFlight.current.get(details) === current.key) inFlight.current.delete(details);
        if (result.ok) {
          setFailed(undefined);
          if (sent.current === current) sent.current = undefined;
          onDone(result.data);
          return;
        }
        leaveIfSignedOut(result.error);
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
      leaveIfSignedOut(result.error);
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
