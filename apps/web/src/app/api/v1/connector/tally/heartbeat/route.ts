import { tallyRouteDeps } from '../../../../../../integrations/tally/route-deps';
import { tallyHeartbeatRoute } from '../../../../../../integrations/tally/routes';

export const dynamic = 'force-dynamic';

/** `POST /api/v1/connector/tally/heartbeat` (docs/06-api.md §3.5): every five minutes. */
export function POST(request: Request): Promise<Response> {
  return tallyHeartbeatRoute(request, tallyRouteDeps());
}
