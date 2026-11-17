import { executeCommand, refreshVoiceToken, startVoiceSession } from '@shakti/domain';
import { commandOptions } from '../actions/support';
import { currentPrincipal } from '../auth/current-principal';
import { defaultAuthDeps } from '../auth/deps';
import { voicePrincipalFromToken } from '../auth/voice-principal';
import type { SessionRouteDeps, TokenRouteDeps } from './handlers';

/**
 * The voice routes' real dependencies: the session or the voice token, the shared store that
 * counts calls, and the two commands, each run in the caller's own companies.
 */
export function sessionRouteDeps(): SessionRouteDeps {
  return {
    principal: currentPrincipal,
    keyValue: defaultAuthDeps().keyValue,
    start: (principal, input, meta) =>
      executeCommand(
        principal,
        { entityIds: principal.entityIds, requestId: meta.requestId },
        startVoiceSession,
        input,
        commandOptions(meta),
      ),
  };
}

export function tokenRouteDeps(): TokenRouteDeps {
  return {
    voicePrincipal: (token) => voicePrincipalFromToken(token),
    keyValue: defaultAuthDeps().keyValue,
    refresh: (principal, meta) =>
      executeCommand(
        principal,
        { entityIds: principal.entityIds, requestId: meta.requestId },
        refreshVoiceToken,
        {},
        commandOptions(meta),
      ),
  };
}
