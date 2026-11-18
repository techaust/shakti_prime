import { CONCIERGE_ACTION_TYPES } from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { AGENT_DEFAULTS } from '../agent-defaults';
import { loadAgentConfig, type ResolvedAgentConfig } from '../config';

// Whether the WhatsApp Concierge may answer chats in a company (A3, the review's M2): switched on,
// with every spending limit above zero. While it may not, a chat a customer opens starts with
// people, the thread screen offers no "give back to the assistant", and a run on a chat it still
// answers hands that chat to people.

/** Whether settings let the agent call the model at all: switched on with every cap above zero. */
export function conciergeMayRun(config: ResolvedAgentConfig): boolean {
  return config.enabled && config.caps.length > 0 && config.caps.every((c) => c.paise > 0);
}

/**
 * Whether the assistant answers the company's chats: `AGENT_DEFAULTS.concierge.handlesNewThreads`
 * and the Concierge's settings for its reply in the company, read under the caller's own
 * policies (any request of the company reads the agent settings).
 */
export async function conciergeAnswersChats(
  tx: RequestContext['tx'],
  entityId: number,
): Promise<boolean> {
  if (!AGENT_DEFAULTS.concierge.handlesNewThreads) return false;
  return conciergeMayRun(
    await loadAgentConfig(tx, 'agent:concierge', CONCIERGE_ACTION_TYPES.reply, entityId),
  );
}
