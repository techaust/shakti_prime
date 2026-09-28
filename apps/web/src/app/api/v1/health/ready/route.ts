import { ErrorEnvelope, ReadyResponse } from '@shakti/contracts';
import en from '../../../../../../messages/en.json';
import { checkReadiness } from '../../../../../auth/readiness';
import { incomingRequestId } from '../../../../../request-id';

export const dynamic = 'force-dynamic';

/** Readiness: dependency checks (docs/API.md §3.7). */
export async function GET(request: Request): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
  const checks = await checkReadiness();
  const time = new Date().toISOString();

  if (Object.values(checks).every((c) => c === 'ok')) {
    return Response.json(ReadyResponse.parse({ status: 'ok', checks, time }), { headers });
  }

  // The one catalogue is English (ADR 0014); a route handler has no request locale to resolve.
  const body = ErrorEnvelope.parse({
    error: {
      code: 'integration_unavailable',
      message: en.errors.integration_unavailable,
      details: { checks },
      requestId,
    },
  });
  return Response.json(body, { status: 503, headers });
}
