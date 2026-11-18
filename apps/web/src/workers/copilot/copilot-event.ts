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
 * The Caller Co-pilot's brief (docs/03-roadmap-appendix/phase2.md §7.3) on `crm.opportunity.assigned`
 * and on `agents.brief.requested`: the agent reads the lead as itself, asks Sonnet 5.5 once and
 * records the brief and what it proposes; a lead briefed within the hour gets nothing new. It runs
 * as the agent's own principal, never as `system:workers`. The event's id keys every step, so a
 * repeat records nothing twice. Switched off, without a spending limit or without
 * `ANTHROPIC_API_KEY`, the run is recorded as stopped or unavailable and no model is called.
 */
export async function handleBriefEvent(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
  deps: CopilotDeps = { provider: aiProvider(), keyValue: ctx.keyValue },
): Promise<CopilotRunResult> {
  return runCopilot(
    {
      eventId: event.id,
      kind: 'brief',
      entityId: event.entityId,
      opportunityId: event.aggregateId,
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
      platform: ctx.principal,
      store: requireFileStore(),
      transcriber: callTranscriber(),
      hosted: hostedRuntime(),
    },
  );
}
