import { currentPrincipal } from '../../../../../../auth/current-principal';
import { defaultAuthDeps } from '../../../../../../auth/deps';
import { postIntegrationReplay } from '../../../../../../observability/integration-routes';

export const dynamic = 'force-dynamic';

/** Puts one dead letter back in the queue (`integrations.dlq.replay`, docs/API.md §3.7). */
export function POST(request: Request): Promise<Response> {
  return postIntegrationReplay(request, {
    principal: currentPrincipal,
    keyValue: defaultAuthDeps().keyValue,
  });
}
