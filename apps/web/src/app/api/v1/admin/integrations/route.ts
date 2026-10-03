import { currentPrincipal } from '../../../../../auth/current-principal';
import { defaultAuthDeps } from '../../../../../auth/deps';
import { getIntegrationHealth } from '../../../../../observability/integration-routes';

export const dynamic = 'force-dynamic';

/** Integration Health for a session holding `admin.integrations.write` (docs/API.md §3.7). */
export function GET(request: Request): Promise<Response> {
  return getIntegrationHealth(request, {
    principal: currentPrincipal,
    keyValue: defaultAuthDeps().keyValue,
  });
}
