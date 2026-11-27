import { tallyRouteDeps } from '../../../../../../integrations/tally/route-deps';
import { tallySnapshotRoute } from '../../../../../../integrations/tally/routes';

export const dynamic = 'force-dynamic';

/** `POST /api/v1/connector/tally/snapshot` (docs/06-api.md §3.5): a company's daily GUID list. */
export function POST(request: Request): Promise<Response> {
  return tallySnapshotRoute(request, tallyRouteDeps());
}
