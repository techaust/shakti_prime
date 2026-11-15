import { ingestRouteDeps } from '../../../../../ingest/route-deps';
import { ingestLeadRoute } from '../../../../../ingest/routes';

export const dynamic = 'force-dynamic';

/** `POST /api/v1/ingest/leads` (docs/06-api.md §3.3): a company website's enquiry, made a lead. */
export function POST(request: Request): Promise<Response> {
  return ingestLeadRoute(request, ingestRouteDeps());
}
