import { syncRouteDeps } from '../../../../../sync/route-deps';
import { syncPushRoute } from '../../../../../sync/routes';

export const dynamic = 'force-dynamic';

/**
 * The field app's push (docs/06-api.md §3.2): the commands recorded offline, applied in order, each
 * answered on its own.
 */
export function POST(request: Request): Promise<Response> {
  return syncPushRoute(request, syncRouteDeps());
}
