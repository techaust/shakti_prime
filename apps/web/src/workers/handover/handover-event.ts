import { HandOverLeadDto, type DeliveredEvent } from '@shakti/contracts';
import { executeCommand, handOverLead, type KeyValue } from '@shakti/domain';
import type { EventHandlerContext } from '../events/registry';

/** How long the round-robin remembers who took the last lead of a company: ninety days. */
const CURSOR_TTL_SECONDS = 90 * 24 * 60 * 60;

/** The key holding the person the round-robin chose last in a company. */
export const handoverCursorKey = (entityId: number): string => `handover:cursor:${String(entityId)}`;

/**
 * The handover worker for one `crm.opportunity.stage_moved` event (docs/03-roadmap-appendix/phase1.md §8.2):
 * an event whose lead did not reach Qualified (`handover` false) is left alone. Otherwise the lead
 * is given to a Lead Converter, or to the Sales Team Lead when none qualifies, as `system:workers`
 * of the event's company (`crm.opportunity.hand_over`), with the cursor the round-robin keeps in
 * Redis per company; the cursor moves to the converter chosen. The event's id is the handover's
 * own, so a repeat delivery changes nothing.
 */
export async function handleHandoverEvent(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
  keyValue: KeyValue = ctx.keyValue,
): Promise<HandOverLeadDto | undefined> {
  if (event.payload.handover !== true) return undefined;
  const key = handoverCursorKey(event.entityId);
  const cursor = await keyValue.get(key);
  const result = await executeCommand(
    ctx.principal,
    { entityIds: [event.entityId], requestId: ctx.requestId },
    handOverLead,
    {
      entityId: event.entityId,
      opportunityId: event.aggregateId,
      eventId: event.id,
      cursor,
    },
  );
  if (result.outcome === 'converter' && result.cursor !== null && result.cursor !== cursor) {
    await keyValue.set(key, result.cursor, CURSOR_TTL_SECONDS);
  }
  return result;
}
