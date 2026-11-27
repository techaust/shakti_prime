import { tallyRouteDeps } from '../../../../../../integrations/tally/route-deps';
import { tallyBatchRoute } from '../../../../../../integrations/tally/routes';

export const dynamic = 'force-dynamic';

/** `POST /api/v1/connector/tally/batches` (docs/06-api.md §3.5): one signed batch of a company. */
export function POST(request: Request): Promise<Response> {
  return tallyBatchRoute(request, tallyRouteDeps());
}
