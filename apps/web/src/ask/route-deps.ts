import { askSourceLabels, executeQuery } from '@shakti/domain';
import { commandOptions } from '../actions/support';
import { currentPrincipal } from '../auth/current-principal';
import { defaultAuthDeps } from '../auth/deps';
import { aiProvider } from '../integrations/ai';
import type { AskRouteDeps } from './route';

/**
 * The Ask route's real dependencies: the session, the shared store, the provider wrapper, and the
 * cited records' words read as the person. No bearer token yet: live voice (V2) adds the voice
 * token's check here.
 */
export function askRouteDeps(): AskRouteDeps {
  return {
    principal: currentPrincipal,
    keyValue: defaultAuthDeps().keyValue,
    provider: aiProvider,
    options: (meta) => commandOptions(meta),
    labels: (principal, turn, requestId) =>
      executeQuery(
        principal,
        { entityIds: turn.conversation.entityIds, requestId },
        (context) => askSourceLabels(context, turn.message.cited),
        { name: 'askSourceLabels' },
      ),
  };
}
