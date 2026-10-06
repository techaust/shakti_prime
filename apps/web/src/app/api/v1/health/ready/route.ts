import { ErrorEnvelope, ReadyResponse, type ErrorCode } from '@shakti/contracts';
import en from '../../../../../../messages/en.json';
import { clientAddress } from '../../../../../auth/client-address';
import { defaultAuthDeps } from '../../../../../auth/deps';
import { checkReadiness, READY_CAP } from '../../../../../auth/readiness';
import { addressKey, countRequest } from '../../../../../auth/request-cap';
import { logger } from '../../../../../log';
import { incomingRequestId } from '../../../../../request-id';

export const dynamic = 'force-dynamic';

/** The one catalogue is English (ADR 0014); a route handler has no request locale to resolve. */
function failure(
  code: Extract<ErrorCode, 'integration_unavailable' | 'rate_limited'>,
  status: number,
  headers: Record<string, string>,
  requestId: string,
): Response {
  const body = ErrorEnvelope.parse({ error: { code, message: en.errors[code], requestId } });
  return Response.json(body, { status, headers });
}

/**
 * Readiness (docs/06-api.md §3.7). The route is public, so the answer carries the overall status
 * only; which dependency is down goes to the log with the request id, for the operators.
 */
export async function GET(request: Request): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };

  let counted: Awaited<ReturnType<typeof countRequest>>;
  try {
    const key = `ready:${addressKey(clientAddress(request.headers))}`;
    counted = await countRequest(defaultAuthDeps().keyValue, key, READY_CAP);
  } catch (error) {
    // The store is one of the dependencies (or the configuration keeps it from opening): the
    // deployment is not ready, and nothing more is checked for a caller who cannot be counted.
    logger.log('warn', 'health.not_ready', { requestId, capUnavailable: true, error });
    return failure('integration_unavailable', 503, headers, requestId);
  }
  if (!counted.allowed) {
    return failure(
      'rate_limited',
      429,
      { ...headers, 'retry-after': String(counted.retryAfter) },
      requestId,
    );
  }

  const checks = await checkReadiness();
  const time = new Date().toISOString();
  if (Object.values(checks).every((c) => c === 'ok')) {
    return Response.json(ReadyResponse.parse({ status: 'ok', time }), { headers });
  }
  logger.log('warn', 'health.not_ready', { requestId, checks });
  return failure('integration_unavailable', 503, headers, requestId);
}
