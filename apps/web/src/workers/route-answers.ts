import { ERROR_HTTP_STATUS, ErrorEnvelope, type ErrorCode } from '@shakti/contracts';
import en from '../../messages/en.json';

/** QStash stops retrying a message whose answer carries this header. */
export const NO_RETRY = { 'upstash-nonretryable-error': 'true' } as const;

/**
 * A worker route's error answer (docs/06-api.md §3.6): the code's status, its sentence and the
 * request id, the one copy every worker route uses (audit ARCH-11).
 */
export function workerFailure(
  code: ErrorCode,
  requestId: string,
  headers: Record<string, string>,
): Response {
  // The one catalogue is English (ADR 0014); a route handler has no request locale to resolve.
  const body = ErrorEnvelope.parse({ error: { code, message: en.errors[code], requestId } });
  return Response.json(body, { status: ERROR_HTTP_STATUS[code], headers });
}
