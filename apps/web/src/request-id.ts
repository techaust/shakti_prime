import { newId } from '@shakti/contracts';

/** Anything that reads a request header by name: `Headers`, or a stand-in for a plain object. */
export interface HeaderReader {
  get(name: string): string | null;
}

/** An id safe to echo into a header, the logs, the audit trail and an error envelope. */
const SAFE_ID = /^[\w.:-]{1,128}$/;

/**
 * The one request-id rule, for every route, server action, auth event and error log line.
 * Vercel's own `x-vercel-id` wins whenever it is there, so a caller cannot choose the id an audit
 * row or a log line carries on a hosted deployment; where the platform sets none (locally, in
 * tests) a caller's `x-request-id` is taken if it is safe to echo. Undefined when neither is
 * usable, and never the caller's id when the platform's is there but unusable.
 */
export function platformRequestId(headers: HeaderReader | undefined): string | undefined {
  if (headers === undefined) return undefined;
  const platform = headers.get('x-vercel-id');
  const given = platform ?? headers.get('x-request-id');
  return given !== null && SAFE_ID.test(given) ? given : undefined;
}

/** The request id of an incoming request under that rule, or a new one when it gives none. */
export function incomingRequestId(headers: HeaderReader | undefined): string {
  return platformRequestId(headers) ?? newId();
}
