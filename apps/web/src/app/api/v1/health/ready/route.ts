import { ErrorEnvelope, newId, ReadyResponse } from '@shakti/contracts';
import { checkDatabaseReady } from '@shakti/db';
import { getTranslations } from 'next-intl/server';

export const dynamic = 'force-dynamic';

/** Readiness: dependency checks. Redis and QStash join in week 3 (docs/API.md §3.7). */
const REQUEST_ID = /^[\w.-]{1,128}$/;

export async function GET(request: Request): Promise<Response> {
  const given = request.headers.get('x-request-id');
  const requestId = given !== null && REQUEST_ID.test(given) ? given : newId();
  const headers = { 'cache-control': 'no-store', 'x-request-id': requestId };
  const database = await checkDatabaseReady();
  const time = new Date().toISOString();

  if (database === 'ok') {
    return Response.json(ReadyResponse.parse({ status: 'ok', checks: { database }, time }), {
      headers,
    });
  }

  const t = await getTranslations('errors');
  const body = ErrorEnvelope.parse({
    error: {
      code: 'integration_unavailable',
      message: t('integration_unavailable'),
      details: { checks: { database } },
      requestId,
    },
  });
  return Response.json(body, { status: 503, headers });
}
