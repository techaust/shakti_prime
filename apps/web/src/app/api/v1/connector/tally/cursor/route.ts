import { tallyRouteDeps } from '../../../../../../integrations/tally/route-deps';
import { tallyCursorRoute } from '../../../../../../integrations/tally/routes';

export const dynamic = 'force-dynamic';

/** `GET /api/v1/connector/tally/cursor?company=` (docs/06-api.md §3.5): where the connector resumes. */
export function GET(request: Request): Promise<Response> {
  return tallyCursorRoute(request, tallyRouteDeps());
}
