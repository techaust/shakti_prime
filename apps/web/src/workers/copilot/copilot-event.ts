import type { DeliveredEvent } from '@shakti/contracts';
import {
  runCopilot,
  summariseCall,
  type CopilotDeps,
  type CopilotRunResult,
  type SummariseDeps,
  type SummariseResult,
} from '@shakti/domain';
import { hostedRuntime } from '../../auth/deps';
import { requireFileStore } from '../../files/uploads';
import { aiProvider } from '../../integrations/ai';
import type { EventHandlerContext } from '../events/registry';
import { callTranscriber } from './call-transcriber';

/**
 * By this long into a delivery, counted from the event route's start, the Co-pilot's work must
 * have ended: the route stops at 60 seconds, and the rest records the note and answers. Each step
 * that waits on a vendor is bounded by what is left, and a run short of time is delivered again.
 */
export const COPILOT_DELIVERY_LIMIT_MS = 50_000;

/** What is left of the delivery's time, on the route's clock (`ctx.startedAt`). */
export function deliveryTimeLeft(ctx: Pick<EventHandlerContext, 'startedAt'>): () => number {
  return () => COPILOT_DELIVERY_LIMIT_MS - (performance.now() - ctx.startedAt);
}

/**
 * The Caller Co-pilot's brief (docs/03-roadmap-appendix/phase2.md §7.3) on `crm.opportunity.assigned`
 * and on `agents.brief.requested`: the agent reads the lead as itself, asks Sonnet 5.5 once and
 * records the brief and what it proposes; a lead briefed within the hour gets nothing new, and an
 * assigned lead (one at a time or many in a reassignment) one briefed within a day. It runs
 * as the agent's own principal, never as `system:workers`. The event's id keys every step, so a
 * repeat records nothing twice. Switched off, without a spending limit or without
 * `ANTHROPIC_API_KEY`, the run is recorded as stopped or unavailable and no model is called.
 */
export async function handleBriefEvent(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
  deps: CopilotDeps = {
    provider: aiProvider(),
    keyValue: ctx.keyValue,
    timeLeft: deliveryTimeLeft(ctx),
  },
): Promise<CopilotRunResult> {
  return runCopilot(
    {
      eventId: event.id,
      kind: 'brief',
      entityId: event.entityId,
      opportunityId: event.aggregateId,
      trigger: event.type === 'crm.opportunity.assigned' ? 'assigned' : 'requested',
    },
    deps,
  );
}

/**
 * The summary of a recorded call on `calls.dial.completed`: the platform (`ctx.principal`, holding
 * `calls.process`) reads the call, transcribes its recording when the company's coverage takes it,
 * masks the transcript and keeps it as the call's file; then the Co-pilot writes the summary, the
 * facts it heard and the outcome to pre-select. Without the speech switch (`CALL_TRANSCRIBE`) no
 * recording leaves the BOS and no summary is written.
 */
export async function handleCallSummaryEvent(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
  deps?: SummariseDeps,
): Promise<SummariseResult> {
  return summariseCall(
    { eventId: event.id, entityId: event.entityId, providerCallId: event.aggregateId },
    deps ?? {
      provider: aiProvider(),
      keyValue: ctx.keyValue,
      timeLeft: deliveryTimeLeft(ctx),
      platform: ctx.principal,
      store: requireFileStore(),
      transcriber: callTranscriber(),
      hosted: hostedRuntime(),
    },
  );
}
