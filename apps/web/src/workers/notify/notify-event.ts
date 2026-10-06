import {
  DomainError,
  NotifyJob,
  type DeliveredEvent,
  type NotifyEventInput,
  type NotifyResult,
} from '@shakti/contracts';
import { executeCommand, notifyEvent } from '@shakti/domain';
import type { EventHandlerContext } from '../events/registry';
import { deliverNoticeBatch } from './deliver-notices';
import type { PushSender } from '../../notifications/push';

type Counts = Omit<Extract<NotifyResult, { outcome: 'done' }>, 'eventId' | 'outcome'>;

/** The notify command's input for one notifying event, its payload checked as the catalogue's. */
export function notifyInputOf(event: DeliveredEvent): NotifyEventInput {
  const parsed = NotifyJob.safeParse(event);
  if (!parsed.success) {
    throw new DomainError('validation_failed', `${event.type} does not notify as sent`, {
      type: event.type,
    });
  }
  const p = event.payload;
  const base = { entityId: event.entityId, eventId: event.id };
  switch (event.type) {
    case 'crm.opportunity.assigned':
      return {
        ...base,
        event: 'crm.opportunity.assigned',
        opportunityId: event.aggregateId,
        ownerId: String(p.ownerId),
        assignedById: typeof p.assignedById === 'string' ? p.assignedById : null,
      };
    case 'crm.duplicate.found':
      return { ...base, event: 'crm.duplicate.found', candidateId: event.aggregateId };
    case 'crm.enquiry.routed':
      return {
        ...base,
        event: 'crm.enquiry.routed',
        itemId: event.aggregateId,
        assigneeId: String(p.assigneeId),
        accountId: String(p.accountId),
      };
    default:
      throw new DomainError('validation_failed', `${event.type} does not notify`, {
        type: event.type,
      });
  }
}

/**
 * The notify worker for one event (docs/design/phase1.md §8.1): the notices it stands for, written
 * as `system:workers` of the event's company (`notifications.event.notify`), then pushed under
 * each person's choices and quiet hours. A repeated delivery writes and pushes nothing new.
 */
export async function handleNoticeEvent(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
  sender?: PushSender,
): Promise<Counts> {
  const batch = await executeCommand(
    ctx.principal,
    { entityIds: [event.entityId], requestId: ctx.requestId },
    notifyEvent,
    notifyInputOf(event),
  );
  return deliverNoticeBatch(ctx.principal, batch, { requestId: ctx.requestId, sender });
}
