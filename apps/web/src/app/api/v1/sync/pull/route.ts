import { syncRouteDeps } from '../../../../../sync/route-deps';
import { syncPullRoute } from '../../../../../sync/routes';

export const dynamic = 'force-dynamic';

/**
 * The field app's pull (docs/06-api.md §3.2): the changes to the person's working set since the
 * cursor, a page at a time.
 */
export function GET(request: Request): Promise<Response> {
  return syncPullRoute(request, syncRouteDeps());
}
