import { askSourceLabels, executeQuery } from '@shakti/domain';
import { commandOptions } from '../actions/support';
import { currentPrincipal } from '../auth/current-principal';
import { defaultAuthDeps } from '../auth/deps';
import { voicePrincipalFromToken } from '../auth/voice-principal';
import { aiProvider } from '../integrations/ai';
import type { AskRouteDeps } from './route';

/**
 * The Ask route's real dependencies: the session, or the voice worker's token for a live voice
 * session (V2), the shared store, the provider wrapper, and the cited records' words read as the
 * person.
 */
export function askRouteDeps(): AskRouteDeps {
  return {
    principal: currentPrincipal,
    bearer: async (token) => (await voicePrincipalFromToken(token))?.principal,
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
