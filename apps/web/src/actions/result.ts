import { DomainError } from '@shakti/contracts';
import { toDomainError, errorKey } from '../auth/errors';
import type { ErrorKey } from '../i18n/types';
import { reportUnexpected } from '../log';

/**
 * What a command or query action answers (review 3, `docs/reviews/2026-09-review3-audit.md`):
 * Next.js masks an error thrown from a server action in production, so an action never throws to
 * a screen. A failure names a sentence under `errors.*`, the field it is about when there is one,
 * and, for an unexpected failure, the reference the person reads to support (DESIGN.md §11).
 */
export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: ErrorKey; reference?: string; field?: string };

/** The dotted path of the first input problem, such as `contact.phone`, when the input failed. */
function firstIssuePath(
  details: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const issues = details?.issues;
  if (!Array.isArray(issues)) return undefined;
  const first: unknown = issues[0];
  if (typeof first !== 'object' || first === null || !('path' in first)) return undefined;
  const path = first.path;
  return typeof path === 'string' && path !== '' ? path : undefined;
}

/**
 * The catalogue reason an input schema names for its first problem, when it names one (a consent
 * text version, `consent_version_invalid`); otherwise undefined and the plain input sentence.
 */
function firstIssueReason(
  details: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  const issues = details?.issues;
  if (!Array.isArray(issues)) return undefined;
  const first: unknown = issues[0];
  if (typeof first !== 'object' || first === null || !('message' in first)) return undefined;
  const message = first.message;
  if (typeof message !== 'string' || !/^[a-z][a-z_]*$/.test(message)) return undefined;
  const key = errorKey(new DomainError('validation_failed', 'input', { reason: message }));
  return key === message ? key : undefined;
}

/** The failure half of an `ActionResult`; an unexpected failure is logged with a reference. */
export function actionFailure(
  action: string,
  e: unknown,
): Extract<ActionResult<never>, { ok: false }> {
  const domain = toDomainError(e);
  const reason = domain.code === 'validation_failed' ? firstIssueReason(domain.details) : undefined;
  const error = (reason ?? errorKey(domain)) as ErrorKey;
  if (domain.code === 'internal' || domain.code === 'integration_unavailable') {
    return { ok: false, error, reference: reportUnexpected('action.failed', e, { action }) };
  }
  const field = domain.code === 'validation_failed' ? firstIssuePath(domain.details) : undefined;
  return field === undefined ? { ok: false, error } : { ok: false, error, field };
}

/** Runs an action's body and answers its result: the data, or the failure as a catalogue key. */
export async function toResult<T>(action: string, run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (e) {
    return actionFailure(action, e);
  }
}
