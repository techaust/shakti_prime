import { HealthResponse } from '@shakti/contracts';

export const dynamic = 'force-dynamic';

/** Liveness: the function is up. No dependency is touched (docs/06-api.md §3.7). */
export function GET(): Response {
  return Response.json(HealthResponse.parse({ status: 'ok', time: new Date().toISOString() }), {
    headers: { 'cache-control': 'no-store' },
  });
}
