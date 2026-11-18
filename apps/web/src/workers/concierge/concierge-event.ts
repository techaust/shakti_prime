import { IdSchema, WhatsAppHandoffReasonSchema, type DeliveredEvent } from '@shakti/contracts';
import {
  executeCommand,
  recordWhatsAppHandOff,
  runConcierge,
  type ConciergeDeps,
  type ConciergeRunResult,
} from '@shakti/domain';
import { aiProvider } from '../../integrations/ai';
import { deliveryTimeLeft } from '../copilot/copilot-event';
import type { EventHandlerContext } from '../events/registry';
import { isHandledByPlatform } from '../messaging/handled-by-platform';

/**
 * The WhatsApp Concierge's worker for one `messaging.message.received` event
 * (docs/03-roadmap-appendix/phase2.md §7.2): a message the platform answers itself (STATUS, a
 * quote's code; `isHandledByPlatform()`) is never the Concierge's. For any other, the agent reads
 * the chat as itself, in a run bound to the event's thread, and records what it would reply; in
 * Shadow, where it starts, nothing is sent and no inbox is filled. It runs as the agent's own
 * principal, never as `system:workers`, whose principal hands a chat to people when a rule or the
 * answer says so (`messaging.thread.record_hand_off`). The event's id keys every step and the
 * model's answer, so a repeat records nothing twice and asks the model nothing again. Switched
 * off, without a spending limit or without `ANTHROPIC_API_KEY`, the run is recorded as stopped or
 * unavailable and no model is called. Bounded by the event route's minute, as the Co-pilot's is.
 */
export async function handleConciergeEvent(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
  deps?: ConciergeDeps,
): Promise<ConciergeRunResult | null> {
  // What the worker reads of the event: the message, and whether the platform answers it.
  const messageId = IdSchema.safeParse(event.payload.messageId);
  if (event.type !== 'messaging.message.received' || !messageId.success) return null;
  if (isHandledByPlatform({ platform: event.payload.platform === true })) return null;
  const threadId = event.aggregateId;
  return runConcierge(
    {
      eventId: event.id,
      entityId: event.entityId,
      threadId,
      messageId: messageId.data,
    },
    deps ?? {
      provider: aiProvider(),
      keyValue: ctx.keyValue,
      timeLeft: deliveryTimeLeft(ctx),
      handOff: async (reason) => {
        await executeCommand(
          ctx.principal,
          { entityIds: [event.entityId], requestId: ctx.requestId },
          recordWhatsAppHandOff,
          { entityId: event.entityId, threadId, reason: WhatsAppHandoffReasonSchema.parse(reason) },
        );
      },
    },
  );
}
