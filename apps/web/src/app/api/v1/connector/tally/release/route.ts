import { tallyRouteDeps } from '../../../../../../integrations/tally/route-deps';
import { tallyReleaseRoute } from '../../../../../../integrations/tally/routes';

export const dynamic = 'force-dynamic';

/** `GET /api/v1/connector/tally/release` (docs/06-api.md §3.5): no release until TC4. */
export function GET(request: Request): Promise<Response> {
  return tallyReleaseRoute(request, tallyRouteDeps());
}
