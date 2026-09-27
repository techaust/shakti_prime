import { ErrorEnvelope, newId, OutboxPublishResponse, type ErrorCode } from '@shakti/contracts';
import en from '../../../../../../../messages/en.json';
import { logger } from '../../../../../../log';
import { publishOutbox } from '../../../../../../workers/outbox';
import { qstashConfig, verifyQStashSignature } from '../../../../../../workers/qstash';

export const dynamic = 'force-dynamic';

/**
 * The outbox publisher (docs/design/backend-weeks-3-5.md §4.2, docs/API.md §3.6). Only QStash
 * calls it, from the minute schedule and from the nudge after a command: every call must carry a
 * valid signature for this route and body. A 500 makes QStash retry; the rows stay pending.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = newId();
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
  const config = qstashConfig();
  if (config === undefined) return failure('integration_unavailable', 503, requestId, headers);

  const body = await request.text();
  const signed = await verifyQStashSignature(
    config,
    request.headers.get('upstash-signature'),
    body,
  );
  if (!signed) {
    logger.log('warn', 'outbox.publish_refused', { requestId });
    return failure('unauthorized', 401, requestId, headers);
  }

  try {
    const counts = await publishOutbox();
    return Response.json(OutboxPublishResponse.parse(counts), { headers });
  } catch (error) {
    logger.log('error', 'outbox.publish_failed', { requestId, error });
    return failure('internal', 500, requestId, headers);
  }
}

function failure(
  code: Extract<ErrorCode, 'integration_unavailable' | 'unauthorized' | 'internal'>,
  status: number,
  requestId: string,
  headers: Record<string, string>,
): Response {
  // The one catalogue is English (ADR 0014); a route handler has no request locale to resolve.
  const body = ErrorEnvelope.parse({ error: { code, message: en.errors[code], requestId } });
  return Response.json(body, { status, headers });
}
