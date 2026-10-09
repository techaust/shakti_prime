import type { DeliveredEvent } from '@shakti/contracts';
import { runTriage, type AgentStepDeps, type TriageResult } from '@shakti/domain';
import { aiProvider } from '../../integrations/ai';
import type { EventHandlerContext } from '../events/registry';

/**
 * The Triage agent's worker for one `crm.lead.created` event (docs/03-roadmap-appendix/phase1.md
 * §9, A1): the agent reads the new lead as itself and records what it proposes, kind by kind,
 * through the agent runtime; in Shadow, where it starts, nothing acts and nothing reaches an
 * inbox. It runs as the agent's own principal, never as `system:workers`, whose principal the
 * delivery is given. The event's id keys every step, so a repeat delivery records nothing twice.
 * Without a spending limit, with a switch off or without `ANTHROPIC_API_KEY`, each run is recorded
 * as stopped or unavailable and no model is called.
 */
export async function handleTriageEvent(
  event: DeliveredEvent,
  _ctx: EventHandlerContext,
  deps: AgentStepDeps = { provider: aiProvider() },
): Promise<TriageResult> {
  return runTriage(
    {
      eventId: event.id,
      entityId: event.entityId,
      opportunityId: event.aggregateId,
      existingCustomer: event.payload.existingAccount === true,
    },
    deps,
  );
}
