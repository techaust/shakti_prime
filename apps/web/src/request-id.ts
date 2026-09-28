import { newId } from '@shakti/contracts';

/** An id safe to echo into a header, the logs and an error envelope. */
const REQUEST_ID = /^[\w.-]{1,128}$/;

/**
 * The request id of an incoming `/api/v1` call: the caller's own `X-Request-Id` when it is well
 * formed, so their log and ours share it (QStash, a monitor, the field app), otherwise a new one.
 */
export function incomingRequestId(headers: Headers): string {
  const given = headers.get('x-request-id');
  return given !== null && REQUEST_ID.test(given) ? given : newId();
}
