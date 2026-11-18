import { ingestRouteDeps } from '../../../../../ingest/route-deps';
import { ingestHealthRoute } from '../../../../../ingest/routes';

export const dynamic = 'force-dynamic';

/** `GET /api/v1/ingest/health` (docs/06-api.md §3.3): whether a website key works. */
export function GET(request: Request): Promise<Response> {
  return ingestHealthRoute(request, ingestRouteDeps());
}
