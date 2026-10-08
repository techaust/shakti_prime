import { ERROR_HTTP_STATUS, ErrorEnvelope, type ErrorCode } from '@shakti/contracts';
import en from '../messages/en.json';

/**
 * The error envelope of an `/api/v1` route (docs/06-api.md §1): the code, the catalogue's sentence
 * for its reason (or for the code), the request id, and the HTTP status the code maps to. The one
 * catalogue is English (ADR 0014), and a route handler has no request locale to resolve.
 */
export function apiFailure(
  code: ErrorCode,
  requestId: string,
  details?: { reason: string },
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  const catalogue: Readonly<Record<string, string>> = en.errors;
  // A reason with its own sentence reads better than the code's general one.
  const message = (details && catalogue[details.reason]) ?? catalogue[code] ?? en.errors.internal;
  const body = ErrorEnvelope.parse({
    error: { code, message, requestId, ...(details === undefined ? {} : { details }) },
  });
  return Response.json(body, {
    status: ERROR_HTTP_STATUS[code],
    headers: { 'cache-control': 'no-store', 'x-request-id': requestId, ...extraHeaders },
  });
}
